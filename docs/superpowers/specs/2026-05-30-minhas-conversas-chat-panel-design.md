# Minhas Conversas — Painel de Chat + Envio (texto e mídia) + Fotos de Contato

**Data:** 2026-05-30
**Status:** Aprovado (aguardando revisão da spec)

## Objetivo

Na aba **Minhas Conversas** de `/meu-numero`, transformar a lista de contatos em uma visão **split de 2 colunas em tela cheia** (estilo WhatsApp Web): lista de contatos à esquerda, painel da conversa selecionada à direita. O painel mostra o histórico de mensagens e permite **enviar texto e mídia** (imagem, vídeo, áudio, documento). Corrigir também as **fotos de perfil** dos contatos, que hoje não aparecem.

## Contexto atual

- Página: `apps/web/src/app/(app)/meu-numero/page.tsx` — client component com abas `Conexão` e `Minhas Conversas`. Hoje `maxWidth: 800`. A lista de conversas tem `cursor: default` e **nenhum `onClick`** (não há painel).
- Avatares: carregados via `GET /api/whatsapp/avatar?number=...` → `evolution.getContactAvatar()` → `POST {evolution.url}/user/avatar` body `{number}`. Retorna `null` para todos hoje (bug a depurar ao vivo).
- Mensagens: tabela `messages` (`id`, `conversation_id`, `direction` `in|out`, `content`, `message_type`, `evolution_message_id`, `sent_at`). Mensagens recebidas não-texto são gravadas com `content = '[mídia]'`.
- Envio de texto **já existe**: `POST /api/whatsapp/send {conversationId, text}` → `whatsapp.sendMessage()` → `evolution.sendText()` (`POST {evolution.url}/send/text` `{number, text, formatJid:true}`). `sendMessage` **persiste** a mensagem `out` na tabela.
- Evolution Go roda no container `evolution_go` (público em `2.25.139.166:8085`), autenticado por `apikey` = token da instância (em `users.evolution_instance_token`).
- Já existe `/conversa/[id]/page.tsx` (página de conversa com modal de delegação) — usar como referência de padrões de UI, mas o painel será um componente próprio embutido no split.

## Arquitetura

### 1. Layout (frontend)
- Na aba `Minhas Conversas`, o container sai do `maxWidth: 800` e ocupa a largura disponível, em **flex de 2 colunas**:
  - **Esquerda** (~360px, largura fixa, rolável): a lista de contatos atual (cabeçalho com Sincronizar + busca + linhas). Cada linha ganha `onClick` que seta `selectedConvId`, `cursor: pointer`, e destaque visual na linha ativa.
  - **Direita** (flex: 1): `<ConversationPanel>` para a conversa selecionada; quando nenhuma selecionada, estado vazio ("Selecione uma conversa").
- A aba `Conexão` permanece com o layout estreito atual (sem alteração).
- **Responsivo:** em telas estreitas (≤ ~760px), ao selecionar um contato o painel cobre a lista, com um botão "← Voltar" no cabeçalho do painel que limpa a seleção.

### 2. ConversationPanel (componente novo)
Arquivo: `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`. Props: `conversationId`, `contactName`, `contactNumber`, `avatarUrl`, `token`, `onBack?`.
- **Cabeçalho:** avatar (foto ou iniciais) + nome/número.
- **Histórico:** carrega `messages` por `conversation_id` (Supabase client, ordenado por `sent_at` asc). Renderiza bolhas:
  - `direction = in` → bolha à esquerda (cinza); `out` → bolha à direita (verde). Horário (`sent_at`) abaixo.
  - Por `message_type`: `text` → texto; `image` → `<img src=media_url>`; `video` → `<video controls>`; `audio` → `<audio controls>`; `document` → link com `fileName`. Legenda (`content`) abaixo da mídia quando houver.
  - Mensagens recebidas com `content = '[mídia]'` (sem `media_url`) mostram um rótulo "[mídia]" (fora de escopo baixar mídia recebida).
  - Auto-scroll para o fim ao carregar/enviar.
- **Atualização:** `setInterval` a cada **5s** recarrega as mensagens da conversa aberta (pega recebidas). Limpa o intervalo ao trocar de conversa/desmontar.
- **Composer:** textarea + botão de anexo + botão Enviar.
  - Enviar texto: `POST /api/whatsapp/send {conversationId, text}`; append otimista + recarrega.
  - Anexar: `<input type=file>` (accept `image/*,video/*,audio/*,application/*`). Ver fluxo de mídia abaixo.

### 3. Envio de mídia
**Fluxo:**
1. Usuário anexa arquivo → front valida tamanho (limite **25 MB**) e tipo.
2. Front faz **upload para Supabase Storage** no bucket `wa-media`, caminho `{userId}/{conversationId}/{timestamp}-{fileSanitizado}`. Obtém URL pública.
3. Front mostra preview + permite legenda opcional, então chama `POST /api/whatsapp/send-media` `{conversationId, mediaUrl, mediaType, fileName, caption?}` (`mediaType` ∈ `image|video|audio|document`, derivado do MIME).
4. Backend `evolution.sendMedia()` envia ao Evolution Go (endpoint/params a confirmar ao vivo — usa a URL pública) e persiste a mensagem (`message_type = mediaType`, `media_url = mediaUrl`, `content = caption ?? fileName`).
5. Front faz append otimista + recarrega.

**Determinação do endpoint de mídia do Evolution Go:** primeiro passo da implementação é sondar ao vivo (`2.25.139.166:8085`, token de instância) os endpoints de mídia disponíveis (`/send/media`, `/send/image`, `/send/document`, etc.) e o formato de payload (URL vs base64). A implementação adota o que o Evolution Go suportar. Se não houver suporte a envio por URL, cair para base64 (respeitando o limite de 25 MB). Se não houver suporte a um tipo, reportar a limitação.

### 4. Banco + Storage
- **Migration** (via Supabase MCP):
  - `ALTER TABLE messages ADD COLUMN media_url text;`
  - `message_type` permanece `text` por padrão; passa a aceitar `image|video|audio|document` (coluna text — sem constraint nova obrigatória; se houver CHECK existente, atualizar).
- **Bucket `wa-media`** no Supabase Storage:
  - Leitura pública (URLs servíveis ao Evolution Go).
  - Policy de `INSERT` restrita a usuários autenticados (upload no próprio caminho `{auth.uid()}/...`).

### 5. Backend
- `apps/api/src/modules/whatsapp/evolution.service.ts`: novo `sendMedia(token, to, mediaUrl, mediaType, fileName, caption?)`.
- `apps/api/src/modules/whatsapp/whatsapp.service.ts`: novo `sendMediaMessage(userId, conversationId, mediaUrl, mediaType, fileName, caption?)` — resolve `contact_number` (RLS), chama `evolution.sendMedia`, persiste a mensagem.
- `apps/api/src/modules/whatsapp/whatsapp.controller.ts`: `POST /api/whatsapp/send-media` + DTO `SendMediaDto`.

### 6. Fotos de contato
- Depurar `getContactAvatar` ao vivo contra o Evolution Go. Possíveis causas: endpoint `/user/avatar` incorreto para o Evolution Go, parsing do retorno, ou contatos sem foto pública. Corrigir endpoint/parsing conforme o que a API expõe; manter fallback de iniciais coloridas quando não houver foto.

## Componentes e responsabilidades (isolamento)
- `meu-numero/page.tsx`: estado de seleção (`selectedConvId`), layout split, lista. Já é grande — extrair o painel para arquivo próprio mantém o foco.
- `ConversationPanel.tsx`: histórico + composer + poll + upload + envio. Interface clara via props.
- `evolution.service`: integração HTTP com Evolution Go (text + media + avatar).
- `whatsapp.service`: orquestração + persistência.

## Tratamento de erros
- Upload Storage falho → mensagem de erro no composer, sem enviar.
- `send`/`send-media` falho → erro visível; mensagem otimista revertida/sinalizada.
- Avatar/endpoint indisponível → fallback de iniciais; sem quebrar a lista.
- Poll com erro → silencioso (mantém histórico atual).

## Testes / verificação
- Backend: build limpo; testar `send-media` com uma URL real contra o Evolution Go ao vivo.
- Frontend: `tsc --noEmit` limpo; teste manual no app (selecionar conversa, ver histórico, enviar texto, enviar imagem/doc/áudio/vídeo, ver bolha renderizada).
- Avatar: confirmar foto aparecendo para ao menos um contato com foto pública (ou documentar limitação).

## Fora de escopo (YAGNI)
- Gravar áudio pelo microfone (apenas anexar arquivo de áudio).
- Renderizar/baixar **mídia recebida** (recebidas não-texto continuam "[mídia]").
- Indicadores de "digitando"/lido/entregue; busca dentro da conversa; realtime via WebSocket (usamos poll de 5s).
