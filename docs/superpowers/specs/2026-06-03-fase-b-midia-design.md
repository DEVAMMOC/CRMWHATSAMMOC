# Fase B — Mídia (recepção nos dois canais + envio pelo Canal) — Design

**Data:** 2026-06-03
**Projeto:** CRMWhats AMMOC (monorepo NestJS API + Next.js web)
**Status:** aprovado para planejamento

## Objetivo

Hoje mídia **recebida** grava apenas o texto `[mídia]` (sem baixar os bytes), tanto no
WhatsApp pessoal (Evolution Go, `/meu-numero`) quanto no Canal oficial Meta (`/canal`).
Esta fase entrega:

1. **Recepção de mídia** (imagem, áudio, vídeo, documento) nos **dois** canais: download
   dos bytes, persistência no bucket `wa-media` e exibição no chat.
2. **Envio de mídia pelo Canal** (Meta): a inbox `/canal` hoje só envia texto; passa a
   enviar mídia também.

Fora de escopo: reprocessamento manual de downloads falhos; templates HSM; envio de
mídia já existe no Evolution (`/meu-numero`) e não muda.

## Decisão de arquitetura — pipeline assíncrono (Abordagem B)

O webhook **salva a mensagem imediatamente** com o `message_type` correto e `media_url`
nulo (estado "baixando"), responde 200 rápido, e dispara um **download em background**
(`void downloadAndStore(...).catch(log)`, sem `await`) que baixa os bytes, sobe pro
bucket `wa-media` e faz `UPDATE` do `media_url` na linha já gravada.

Justificativa:
- Mantém o webhook rápido — essencial para a Meta, que **reenvia** o evento se o webhook
  demorar a responder 200.
- A mensagem nunca se perde mesmo se o download falhar (a linha já está gravada).
- O poll de 5s já existente nos painéis faz a mídia aparecer sozinha quando o
  `media_url` é preenchido — sem precisar de realtime/websocket.

Abordagens descartadas: (A) download síncrono no webhook — latência + risco de timeout
e reenvio da Meta; (C) download preguiçoso na visualização — URLs/refs da Meta e do
whatsmeow **expiram**, então a mídia sumiria depois de um tempo.

## Modelo de dados

- **`messages`** (Evolution): já possui `media_url text` e `message_type` (enum
  `message_type`: `text | image | document | audio | video`). **Sem mudança de schema.**
- **`canal_messages`** (Meta): adicionar via migração
  - `message_type message_type NOT NULL DEFAULT 'text'`
  - `media_url text`
- **Estado "baixando"** é derivado, sem coluna nova: `message_type <> 'text'` **e**
  `media_url IS NULL`. Falha de download deixa a linha sem `media_url` (logada); o front
  exibe placeholder. Não há coluna de status (YAGNI) e não há retry automático.

## Recepção — Evolution Go (`apps/api/src/modules/whatsapp/webhook.service.ts`)

1. Detectar mídia no payload whatsmeow: `imageMessage` / `videoMessage` / `audioMessage`
   / `documentMessage` / `stickerMessage` (e variantes capitalizadas, via o helper `pick`
   já existente).
2. Mapear para `message_type`: imagem→`image`, vídeo→`video`, áudio/ptt→`audio`,
   documento→`document`, sticker→`image`.
3. `content` = caption (imagem/vídeo) || `fileName` (documento) || `''`.
4. Gravar a linha em `messages` com `message_type` correto e `media_url = null`
   (mantém o `upsert` por `evolution_message_id` já existente).
5. Disparar background `downloadAndStore`:
   - Novo método `EvolutionService.downloadMedia(token, mediaMsg)` →
     `POST /message/downloadmedia` (whatsmeow `DownloadMediaWithPath`; campos esperados:
     `directPath`, `mediaKey`, `fileEncSha256`, `fileSha256`, `fileLength`, `mediaType` /
     `mmsType`). **O contrato exato (nomes do corpo e formato da resposta — base64 vs
     binário) é confirmado contra o Swagger ao vivo (`http://2.25.139.166:8085`) na
     primeira task do plano**, pois os exemplos públicos divergem deste fork.
   - Upload em `wa-media`, caminho `incoming/<ownerUserId>/<conversationId>/<msgId>.<ext>`.
   - `UPDATE messages SET media_url = <publicUrl> WHERE evolution_message_id = <id>`.

## Recepção — Canal / Meta Cloud API

Webhook `apps/api/src/modules/canal/canal-webhook.controller.ts`:
- Estender o parse de `value.messages[]` para os tipos `image | audio | video | document
  | sticker`, extraindo `{ id, mime_type, caption?, filename? }` do objeto do tipo
  correspondente (ex.: `m.image.id`, `m.document.filename`).
- `content` = caption || filename || `''`.

`CanalConversationService.ingestInbound(...)`:
- Aceitar campos novos `messageType`, `mediaId`, `mime`, `fileName`.
- Gravar `canal_messages` com `message_type` + `media_url = null` (mantém upsert por
  `wa_message_id`).
- Disparar background `downloadAndStoreCanal`:
  - `MetaService.downloadMedia(mediaId)` → GET `${GRAPH}/<mediaId>` (retorna `url`
    temporária + `mime_type`) → baixar essa `url` com header `Authorization: Bearer
    <access_token>` → bytes.
  - Upload em `wa-media`, caminho `canal/<conversationId>/<msgId>.<ext>`.
  - `UPDATE canal_messages SET media_url WHERE wa_message_id = <id>`.

## Envio de mídia — Canal / Meta

- Endpoint novo `POST /canal/conversations/:id/send-media`
  (`canal-inbox.controller.ts`), corpo `{ mediaUrl, mediaType, fileName, caption? }`,
  espelhando o `reply` (mesma checagem da janela de 24h da Meta).
- `MetaService.sendMedia(phoneNumberId, to, type, link, caption?, filename?)`:
  Graph `POST /<phoneNumberId>/messages` com `type` em `image|audio|video|document` e
  `{ link }` (a Meta aceita envio de mídia por **link** público — reaproveita as URLs do
  bucket `wa-media`, que é público). `filename` para documentos; `caption` para
  imagem/vídeo/documento.
- Gravar `canal_messages` `out` com `media_url` + `message_type`, atualizar
  `last_message_at` e `status='human'` (igual ao `reply`).

## Frontend

- **`apps/web/src/app/(app)/canal/CanalPanel.tsx`**:
  - Adicionar o botão 📎 + fluxo de upload idêntico ao `ConversationPanel`
    (upload para `wa-media` no client → `POST .../send-media`), incluindo limite de 25 MB
    e o helper `mediaTypeFromMime`.
  - Adicionar o bloco de renderização de mídia (imagem/vídeo/áudio/documento) e o
    placeholder "baixando…" quando `message_type <> 'text' && !media_url`.
  - Ampliar a interface `Message` do painel com `message_type` e `media_url`, e o
    `select` das mensagens para incluir essas colunas.
- **`apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`**:
  - A renderização com `media_url` já funciona. Adicionar apenas o placeholder
    "baixando…" para mídia recebida pendente (`message_type <> 'text' && !media_url`),
    no lugar do `[mídia]`.

## Storage

- Bucket `wa-media` reutilizado (público, limite 25 MB). Uploads de recepção são
  **server-side** via o client service-role já usado nos serviços de webhook.
- Extensão do arquivo derivada do mime (`image/jpeg`→`.jpg`, `audio/ogg`→`.ogg`,
  `application/pdf`→`.pdf`, etc.); fallback `.bin`. Helper compartilhado `mimeToExt`.

## Tratamento de erros

- Todo o background é envolto em `try/catch` com `logger.warn/error`; o webhook **sempre**
  responde 200 rápido e nunca depende do download.
- Download da Meta exige o `Bearer` na URL temporária; mime vem da resposta do GET do
  media-id.
- Falha de download = linha sem `media_url` (placeholder no front). Sem retry automático.

## Testes

- Unitários (padrão `*.spec.ts` existente, ex.: `webhook.service.spec.ts`):
  - Detecção/mapeamento de tipo de mídia no parser do Evolution.
  - Parse de mídia no webhook do Canal (extração de `id`/`mime`/`caption`/`filename`).
  - Helper `mimeToExt`.
  - Mock dos métodos de download (`EvolutionService.downloadMedia`,
    `MetaService.downloadMedia`) — verificar que o upload e o `UPDATE` ocorrem.
- Verificação ao vivo: deploy via API do Coolify + envio/recebimento de mídia real nos
  dois canais (imagem, áudio, documento), confirmando exibição no chat.

## Riscos / dependências

- **Contrato do `/message/downloadmedia`** do Evolution Go — confirmar nomes de campos e
  formato da resposta contra o Swagger ao vivo (primeira task do plano).
- Tamanho de mídia recebida vs. limite de 25 MB do bucket — mídia da Meta/WhatsApp
  raramente excede; se exceder, o upload falha e cai no placeholder (aceitável nesta fase).
