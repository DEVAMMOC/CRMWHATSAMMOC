# Canal AMMOC — Fase 1 (Multi-número, API Oficial Meta) — Design Spec

**Data:** 2026-05-30
**Status:** Aprovado (aguardando revisão da spec)
**Supersede (parcial):** [2026-05-29-canal-ammoc-design.md](2026-05-29-canal-ammoc-design.md) — este doc detalha **só a Fase 1** e **remove a limitação de número único** (multi-número). Bot (Fase 2) e bridge Evolution↔Meta (Fase 3) ficam fora.

## Objetivo

Receber e responder mensagens de cidadãos pelos **números oficiais da AMMOC** (WhatsApp Cloud API da Meta), exibindo tudo num **inbox único no CRM** marcado por número, com **delegação manual** por setor/funcionário (reaproveitando os setores e a delegação já existentes). Suporta **múltiplos números dedicados** sob uma mesma WABA. **Sem bot/IA** nesta fase.

## Decisões (do brainstorming)

- **Credenciais Meta:** o admin já tem conta Meta/WABA; falta adicionar/verificar número(s). A integração é construída agora; o teste real de envio depende de um número verificado.
- **Escopo:** Fase 1 (sem bot, sem bridge).
- **Multi-número:** **inbox único marcado por número** — todos os números caem numa mesma caixa; cada conversa mostra por qual número AMMOC chegou.
- **Topologia Meta (assumida):** **uma WABA com vários números** (um access token de System User no nível do negócio; cada número com seu `phone_number_id`). Webhook único no App Meta. (Se no futuro houver números em contas Meta distintas, estende-se o modelo — YAGNI agora.)
- **Config:** tela com formulário de credenciais + **passo a passo da Meta embutido**.

## Modelo de Dados (Supabase, via MCP)

```sql
-- Config da WABA (nível do negócio) — uma linha (singleton)
CREATE TABLE canal_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id        text NOT NULL DEFAULT '',
  access_token   text NOT NULL DEFAULT '',   -- System User token (tratado como segredo)
  verify_token   text NOT NULL DEFAULT '',   -- valida o GET do webhook
  app_secret     text NOT NULL DEFAULT '',   -- valida X-Hub-Signature-256
  updated_at     timestamptz DEFAULT now()
);

-- Números dedicados da AMMOC (N por WABA)
CREATE TABLE canal_numbers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id  text NOT NULL UNIQUE,      -- ID do número na Meta
  display_number   text NOT NULL,             -- "+55 49 3441-0000"
  label            text NOT NULL DEFAULT '',  -- "Atendimento Geral"
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- Conversas do canal (cidadão ↔ número AMMOC)
CREATE TABLE canal_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_number_id   uuid NOT NULL REFERENCES canal_numbers(id) ON DELETE CASCADE,
  wa_contact_number text NOT NULL,            -- número do cidadão (E.164 sem +)
  wa_contact_name   text,
  sector_id         uuid REFERENCES sectors(id) ON DELETE SET NULL,
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'open',   -- 'open' | 'human' | 'closed'
  last_in_at        timestamptz,              -- última msg do cidadão (p/ janela 24h)
  last_message_at   timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE (canal_number_id, wa_contact_number)
);

CREATE TABLE canal_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES canal_conversations(id) ON DELETE CASCADE,
  direction       text NOT NULL,              -- 'in' | 'out'
  content         text NOT NULL,
  wa_message_id   text UNIQUE,                -- dedup
  sent_by         uuid REFERENCES users(id),  -- null = sistema
  sent_at         timestamptz DEFAULT now()
);

CREATE INDEX idx_canal_conv_status      ON canal_conversations(status);
CREATE INDEX idx_canal_conv_assigned    ON canal_conversations(assigned_to);
CREATE INDEX idx_canal_conv_number      ON canal_conversations(canal_number_id);
CREATE INDEX idx_canal_msg_conversation ON canal_messages(conversation_id);
```

**RLS:** `canal_config`/`canal_numbers` — leitura/escrita só admin/supervisor. `canal_conversations`/`canal_messages` — leitura: admin/supervisor veem tudo; funcionário vê só as conversas com `assigned_to = auth.uid()`. (Espelha o padrão de `current_user_role()` já usado em `messages_select`.) A escrita do webhook usa o service-role (bypassa RLS).

**Segredos:** `access_token`/`app_secret` são sensíveis. Nesta fase ficam em coluna text protegida por RLS (admin-only) + nunca expostos em respostas GET (a API retorna mascarado, ex.: `••••1234`). Criptografia em repouso (pgcrypto) fica como melhoria futura anotada.

## Backend — módulo `canal` (NestJS)

```
apps/api/src/modules/canal/
  canal.module.ts
  canal-webhook.controller.ts   ← GET (verify) + POST (eventos), público, valida assinatura
  canal-inbox.controller.ts     ← endpoints autenticados (AuthGuard)
  canal-config.controller.ts    ← config WABA + CRUD de números (admin/supervisor)
  meta.service.ts               ← Graph API: enviar texto, validar assinatura
  canal-conversation.service.ts ← upsert conversa, inserir msg, listar, delegar, encerrar
  dto/ (save-config, add-number, send-message, delegate, ...)
```

**Endpoints:**
```
# Webhook Meta (público)
GET  /api/canal/webhook    ← responde hub.challenge se hub.verify_token == canal_config.verify_token
POST /api/canal/webhook    ← valida X-Hub-Signature-256 (app_secret); processa mensagens

# Inbox (AuthGuard)
GET  /api/canal/conversations            ← lista (admin/supervisor: todas; funcionário: as suas) + número/setor/status
GET  /api/canal/conversations/:id        ← detalhes + mensagens
POST /api/canal/conversations/:id/message ← enviar resposta (texto) via Meta
POST /api/canal/conversations/:id/delegate ← setor/funcionário (admin/supervisor) → status 'human'
POST /api/canal/conversations/:id/close   ← encerrar → status 'closed'

# Config (admin/supervisor)
GET  /api/canal/config            ← config WABA (token mascarado) + lista de números
PUT  /api/canal/config            ← salva waba_id, access_token, verify_token, app_secret
POST /api/canal/numbers           ← adiciona número {phone_number_id, display_number, label}
DELETE /api/canal/numbers/:id     ← remove número
POST /api/canal/test-connection   ← chama Graph API (GET phone number) p/ validar token
```

**Webhook inbound (POST):**
1. Valida `X-Hub-Signature-256` com `app_secret` (HMAC SHA-256 do corpo cru). Inválido → 401.
2. Para cada `entry[].changes[].value.messages[]`:
   - `phone_number_id = value.metadata.phone_number_id` → busca `canal_numbers` (ignora se número desconhecido/inativo).
   - `wa_contact_number = messages[].from`; nome de `value.contacts[].profile.name`.
   - Upsert `canal_conversations` por `(canal_number_id, wa_contact_number)`; atualiza `last_in_at`/`last_message_at`. Se estava `closed`, reabre como `open`.
   - Insere `canal_messages` (`direction='in'`, `wa_message_id` p/ dedup via UNIQUE).
3. Responde 200 rápido (processa de forma síncrona mas leve; sem bloquear).

**MetaService.sendText(numberConfig, to, text):** `POST https://graph.facebook.com/v21.0/{phone_number_id}/messages` com `Authorization: Bearer {access_token}`, body `{ messaging_product:'whatsapp', to, type:'text', text:{ body } }`. Persiste `canal_messages` (`direction='out'`, `sent_by`).

**Janela de 24h:** ao enviar pelo inbox, se `now - last_in_at > 24h`, a API retorna erro amigável ("Fora da janela de 24h — requer template aprovado, não disponível nesta fase") e o front desabilita o envio com aviso. (Templates/HSM fora de escopo.)

## Frontend

**Sidebar (admin/supervisor):** seção "Canal AMMOC" → `📡 Inbox` (`/canal`) e `⚙️ Config` (`/canal/config`).

**`/canal` — inbox split** (reaproveita o padrão do `ConversationPanel`):
- Esquerda: lista de conversas com **badge do número** (label) + setor + status + última msg/hora. Filtros: Aguardando | Em atendimento | Encerradas | Todas. Busca.
- Direita: histórico (bolhas in/out) + campo de resposta (texto). Botões: **Delegar** (modal setor/funcionário, reusa o de delegação) e **Encerrar**. Poll ~5s (consistente com o resto do app). Campo de envio desabilitado com aviso quando fora da janela 24h.

**`/canal/config`** (admin/supervisor):
- Form WABA: WABA ID, Access Token (senha, mascarado ao reler), Verify Token, App Secret. Botão **Testar conexão**.
- **Lista de números** (CRUD): adicionar `phone_number_id` + número exibido + rótulo; ativar/remover.
- **Passo a passo embutido** para configurar o App/Webhook na Meta (URL do webhook: `https://crm.ammoc.org.br/api/canal/webhook`, eventos `messages`, e o Verify Token).

## Componentes e responsabilidades (isolamento)
- `canal-webhook.controller` + `meta.service`: borda com a Meta (entrada/saída), sem regra de inbox.
- `canal-conversation.service`: toda a persistência/estado de conversas e mensagens.
- `canal-inbox.controller`/`canal-config.controller`: API autenticada do CRM.
- Front: `/canal` (inbox) e `/canal/config` (config) isolados; o painel de conversa é um componente próprio.

## Tratamento de erros
- Webhook com assinatura inválida → 401, log; nunca processa.
- Número desconhecido no payload → ignora (não cria conversa).
- Falha de envio Meta (token inválido, fora de janela) → erro claro no inbox; mensagem não é persistida como enviada.
- `Testar conexão` reporta o motivo do erro da Graph API.

## Testes / verificação
- Backend: build limpo; teste do verify (GET webhook com token certo → challenge; errado → 403) e da validação de assinatura.
- DB: migrations aplicadas e tabelas/índices conferidos.
- Frontend: `tsc --noEmit` limpo; inbox renderiza e lista (mesmo vazio).
- Ponta-a-ponta (envio/recebimento real): **após o admin verificar um número na Meta** e salvar credenciais. Documentar como pendente até lá.

## Fora de escopo (YAGNI, Fase 1)
- Bot/IA e roteamento automático (Fase 2).
- Bridge Evolution↔Meta — funcionário responder pelo WhatsApp pessoal (Fase 3); aqui responde pelo inbox do CRM.
- Templates/HSM (mensagens fora da janela 24h).
- Mídia no canal (texto primeiro; mídia recebida registrada como "[mídia]").
- Múltiplas WABAs / token por número.
- Criptografia em repouso dos segredos (anotada como melhoria; por ora RLS admin-only + mascaramento).
- Encerramento automático por timeout e gatilhos por palavra-chave (eram da Fase 2/3 do spec original).
