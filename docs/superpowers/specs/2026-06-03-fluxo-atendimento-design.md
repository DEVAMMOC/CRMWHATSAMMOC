# Fluxo de atendimento (Canal) + visibilidade + card + notificações — Design

**Data:** 2026-06-03 · **Projeto:** CRMWhats AMMOC · **Status:** aprovado para planejamento

## Objetivo
Melhorar o fluxo de atendimento do Canal e a visibilidade no "Meu Painel":
1. Conversa **delegada** aparece no painel do destinatário como **"Aguardando"** (não só notificação).
2. Conversa do **número pessoal compartilhada** fica **visível na hora** (sem etapa de aceitação).
3. Botão **"Assumir atendimento"** (Aguardando→Em atendimento, registra quem assumiu); **transferência** entre funcionários detectada.
4. **Mensagens de sistema** nos eventos (delegar/assumir/transferir): pílula interna na timeline **+** aviso ao cidadão no WhatsApp.
5. **Card** mostra status + setor + cidade + assunto; assunto/cidade editáveis no Canal.
6. **Notificações** num **sino no canto superior direito** (sai do menu lateral).

Escopo do fluxo completo = **Canal** (`canal_conversations`). No número pessoal só muda: compartilhar→visível na hora + card com metadados.

## Modelo de dados (migração via MCP)
- `canal_conversations`: `+ subject text`, `+ municipality text`, `+ assumed_by uuid references users(id) on delete set null`, `+ assumed_at timestamptz`.
- `canal_messages`: `+ is_system boolean not null default false`.
- `conversations`: `+ subject text` (só p/ exibir; `municipality` já existe).
- Tipo `CanalMessage` (packages/types) += `is_system: boolean`. `CanalConversation` += `subject`, `municipality`, `assumed_by`, `assumed_at`.

## 1. Visibilidade
- **Delegar (Canal)** — `CanalConversationService.delegate`: ao delegar, setar `status='open'` (Aguardando) + `sector_id`/`assigned_to`; mantém a notificação in-app já existente. (Hoje setava `'human'`.) Como a RLS escopa por `assigned_to`/`leads_sector`, a conversa já aparece no Recebidos/Kanban do destinatário como "Aguardando".
- **Compartilhar (pessoal)** — `ConversationShareController.share`: setar `status='ativa'` direto (era `'pendente'`) → visível imediatamente, sem o "Assumir" do `/recebidos`.

## 2. Assumir / transferir (Canal)
- Novo `POST /canal/conversations/:id/assume` → `CanalConversationService.assume(id, userId)`: valida acesso; setar `status='human'`, `assigned_to=userId` (se nulo), `assumed_by=userId`, `assumed_at=now`; dispara evento de sistema "assumiu" (ver §4).
- **Transferência** = `delegate` para outro `assignedTo`. Em `delegate`, ler o `assigned_to` anterior; se mudou para outro usuário não-nulo, é transferência → evento de sistema "direcionado para {novo}".
- Front: botão **"Assumir atendimento"** nos cards/painel quando `status='open'` e a conversa é do usuário (atribuída a ele ou do seu setor). Chama o endpoint e recarrega.

## 3. Mensagens de sistema (eventos)
Helper interno `CanalConversationService.systemEvent(conversationId, text)`:
- Grava `canal_messages` `{ conversation_id, direction:'out', content:text, is_system:true, message_type:'text', sent_at:now }`.
Helper `notifyCitizen(conv, text)`:
- Se `last_in_at` existe e está dentro de 24h → `MetaService.sendText(phone_number_id, wa_contact_number, text)`. Fora da janela → só loga (não envia, não grava como mensagem do atendente).
Eventos (cada um chama systemEvent + notifyCitizen):
- **Delegar p/ setor:** interno `🔀 Delegado ao setor {setor}`; cidadão `Seu atendimento foi encaminhado ao setor {setor}.`
- **Assumir:** interno `✋ {nome} assumiu o atendimento`; cidadão `Olá! Sou {nome} e vou seguir com o seu atendimento.`
- **Transferir p/ funcionário:** interno `↪️ Direcionado para {nome}`; cidadão `Seu atendimento foi direcionado para {nome}.`
- `{setor}`/`{nome}` resolvidos via `sectors.name` / `users.name`.

## 4. Card com status + notas
- **Lista do Canal** (`canal/page.tsx`), **Kanban** (`kanban/page.tsx`) e o cabeçalho do `CanalPanel`: exibir badge de status + setor + cidade + assunto (quando houver). Card pessoal (`recebidos`/`dashboard`/`conversa`) mostra cidade/assunto quando houver.
- Edição: no cabeçalho do `CanalPanel`, campos inline de **assunto** e **cidade** → `POST /canal/conversations/:id/meta` (`CanalSetMetaDto { subject?, municipality? }`) → `CanalConversationService.setMeta`.
- Mensagens `is_system` renderizam como **pílula cinza centralizada** (não como bolha in/out) no `CanalPanel`.

## 5. Notificações no topo (sino)
- Novo `NotificationBell` (client) **fixo no canto superior direito** (`position: fixed; top; right; z-index` acima do conteúdo; também no `topbar` mobile). 🔔 + badge de não-lidas (contagem de `notifications` por RLS, igual à lógica atual do Sidebar).
- Clique → dropdown com as ~10 notificações mais recentes; item leva ao `link` e marca `read`/`read_at`; ações "marcar todas como lidas" e "ver todas" (→ `/notificacoes`).
- **Remover** o item "Notificações" do `Sidebar` (`WHATSAPP_NAV`) e a lógica de badge `unread` que vivia lá (passa pro sino). `/notificacoes` permanece.

## Testes
- **API unit:** `delegate` seta `open` + detecta transferência (assigned anterior≠novo) e chama systemEvent; `assume` seta human/assumed_by + systemEvent; `setMeta` grava subject/municipality; `share` (pessoal) seta `ativa`. Mock de `MetaService.sendText`/notifyCitizen (verifica que NÃO envia fora da janela 24h).
- **Front:** `next build` (typecheck/lint). Verificação ao vivo após deploy.
- **RLS/migração:** verificar colunas criadas via SQL.

## Riscos / notas
- Aviso ao cidadão fora da janela 24h da Meta não é enviado (só interno) — comportamento aceitável (sem template HSM nesta fase).
- `is_system` em `canal_messages`: a inbox lê `select('*')`, então o campo já chega ao front; renderização condicional evita confundir com bolha normal.
- Sino fixo no topo não deve sobrepor ações do cabeçalho dos painéis — usar z-index e posição que não cubram botões (canto bem à direita, com respiro).
