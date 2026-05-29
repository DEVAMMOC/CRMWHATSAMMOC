# WhatsApp Connection & Conversation Sharing — Design Spec

**Date:** 2026-05-29
**Status:** Approved

---

## 1. Goal

Allow each AMMOC funcionário to connect their own WhatsApp number to the system via Evolution Go, receive messages in real time, and selectively share conversations with the organization. Shared conversations are persisted in the database and exported as `.md` files for context/RAG use.

---

## 2. Architecture Overview

```
Browser (/meu-numero)
  └── Next.js API routes (polling: QR, status)
        └── NestJS API (apps/api)
              ├── WhatsAppModule
              │     ├── EvolutionService   → Evolution Go HTTP API
              │     ├── WhatsAppController → /api/whatsapp/*
              │     └── WebhookController  → /api/webhook/whatsapp
              └── ContextModule
                    └── ContextService     → generates .md files
                          └── context_files table (Supabase)
```

**Key constraint:** Evolution Go runs on `2.25.139.166:8085`. Global auth header: `apikey: EvolutionGo@2025Secure`. Per-instance auth: `token` header (UUID, stored in `users.whatsapp_instance_token`).

---

## 3. Database Changes

### 3.1 `users` table — new columns

| Column | Type | Description |
|---|---|---|
| `whatsapp_instance_token` | `uuid` nullable | Evolution Go instance token; null = not connected |
| `whatsapp_instance_id` | `text` nullable | Evolution Go instance ID (returned by create) |
| `whatsapp_status` | `text` default `'disconnected'` | `disconnected` / `connecting` / `connected` |
| `whatsapp_number` | `text` nullable | Connected phone number (e.g. `5547999999999`) |

### 3.2 `conversations` table — existing, no schema change needed

Status values already cover the flow:
- `nao_salva` — received via webhook, not yet shared
- `pendente` — shared by funcionário, waiting for attendance
- `ativa` — being attended
- `encerrada` — closed

New columns needed:

| Column | Type | Description |
|---|---|---|
| `shared_at` | `timestamptz` nullable | When the funcionário clicked "Compartilhar" |
| `shared_by` | `uuid` nullable FK `users.id` | Who shared it |
| `remote_jid` | `text` nullable | WhatsApp JID of the contact (e.g. `5547999@s.whatsapp.net`) |
| `owner_user_id` | `uuid` nullable FK `users.id` | Funcionário whose WhatsApp received this conversation |

### 3.3 `messages` table — existing columns required

The following columns must exist (verified against migration `20260528000001_initial_schema.sql`):

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `conversation_id` | `uuid` FK | |
| `direction` | `text` | `'in'` or `'out'` |
| `content` | `text` | Message text body |
| `message_type` | `text` | `text` / `image` / `audio` / `document` / `video` |
| `whatsapp_message_id` | `text` unique | Evolution Go message ID, used for dedup |
| `created_at` | `timestamptz` | |

If `whatsapp_message_id` column is missing from the migration, it must be added.

---

## 4. NestJS WhatsApp Module (`apps/api/src/whatsapp/`)

### 4.1 Files

| File | Responsibility |
|---|---|
| `whatsapp.module.ts` | Registers controllers + providers, imports HttpModule |
| `evolution.service.ts` | HTTP client for Evolution Go API |
| `whatsapp.controller.ts` | REST endpoints for the front-end |
| `webhook.controller.ts` | Receives Evolution Go webhook events |
| `webhook.service.ts` | Processes events, persists to DB |
| `dto/connect.dto.ts` | Input validation for connect/pair requests |

### 4.2 EvolutionService — method signatures

```typescript
createInstance(userId: string, token: string): Promise<{ id: string; name: string }>
connectInstance(token: string, webhookUrl: string): Promise<void>
getQR(token: string): Promise<{ base64: string }>
pairInstance(token: string, phone: string): Promise<{ code: string }>
getStatus(token: string): Promise<{ status: string }>
deleteInstance(instanceId: string): Promise<void>
```

All methods set `apikey: EvolutionGo@2025Secure` header. Instance-specific methods additionally set `token: <token>` header.

Base URL sourced from `configuration.ts` → `process.env.EVOLUTION_URL`.

### 4.3 WhatsAppController endpoints

All routes prefixed `/api/whatsapp`, protected by `JwtAuthGuard`. User identity from JWT.

| Method | Path | Action |
|---|---|---|
| `POST` | `/connect` | Creates Evolution instance + calls connectInstance → QR flow |
| `GET` | `/qr` | Returns current QR base64 (for polling) |
| `POST` | `/pair` | Calls pairInstance with `body.phone` → returns 8-digit code |
| `GET` | `/status` | Returns `whatsapp_status` from users table |
| `DELETE` | `/disconnect` | deleteInstance + clears user columns |

`POST /connect` flow:
1. Generate `token = uuidv4()`
2. Call `createInstance(userId, token)` → get `instanceId`
3. Save `token` + `instanceId` to `users` row
4. Call `connectInstance(token, webhookUrl)` where `webhookUrl = API_PUBLIC_URL + /api/webhook/whatsapp`
5. Return `{ status: 'connecting' }`

### 4.4 WebhookController

```
POST /api/webhook/whatsapp
```

No JWT guard (Evolution Go cannot send tokens). Validates a shared secret via `x-webhook-secret` header (env var `WEBHOOK_SECRET`).

Delegates all logic to `WebhookService`.

### 4.5 WebhookService — event handling

**`messages.upsert` event:**
1. Extract `remoteJid`, `messageId`, `content`, `direction`, `timestamp`
2. Find `owner_user_id` by matching instance token from event payload
3. Upsert `conversations` row: key = `(remote_jid, owner_user_id)`, status = `nao_salva` if new
4. Insert `messages` row (skip if `whatsapp_message_id` already exists)

**`connection.update` event:**
1. Find user by instance token
2. Update `users.whatsapp_status` to `connected` / `disconnected` / `connecting`
3. If `connected`, also save `whatsapp_number` from event payload

---

## 5. Conversation Sharing Flow

### 5.1 Front-end: `/meu-numero` page — two tabs

**Tab "Conexão":** existing QR/pair UI (to be built).

**Tab "Minhas Conversas":**
- Fetches `conversations` where `owner_user_id = me` and `status IN ('nao_salva', 'pendente')`
- Columns: contact name/number, last message preview, date, status badge, "Compartilhar" button
- "Compartilhar" calls `PATCH /api/conversations/:id/share`
- Once shared, status badge changes to "Pendente" and button disappears

### 5.2 API: `POST /api/conversations/:id/share`

Implemented inside `WhatsAppModule` (or a dedicated `ConversationsModule` if it already exists):
1. Verify requester owns the conversation (`owner_user_id = req.user.id`)
2. Update `conversations`: `status = 'pendente'`, `shared_at = now()`, `shared_by = req.user.id`
3. Call `ContextService.generateConversationMd(conversationId)` → saves to `context_files`
4. Return updated conversation

### 5.3 ContextService — `.md` generation

```typescript
generateConversationMd(conversationId: string): Promise<void>
```

1. Fetch conversation + messages (ordered by `created_at`)
2. Fetch contact info (name from conversations, number from `remote_jid`)
3. Build Markdown:

```markdown
# Conversa: {contact_name} ({remote_jid})

**Atendente:** {owner_user_name}
**Data início:** {first_message_date}
**Compartilhado em:** {shared_at}

---

## Mensagens

**{timestamp} [{in/out}]** {content}

...
```

4. Upsert `context_files` row: `conversation_id`, `type = 'md'`, `content = <markdown string>`, `file_path = conversations/{conversationId}.md`
5. If `github_sync_config` is active for the org, push file to GitHub repo

---

## 6. Front-end Pages Affected

| Page | Change |
|---|---|
| `/meu-numero` | Full rebuild: connection tab (QR + pair) + conversations tab |
| `/dashboard` | No change needed — already shows `pendente` conversations |
| `/base` | May show contacts received via webhook (future enhancement, out of scope here) |

---

## 7. Environment Variables Required

| Variable | Where | Value |
|---|---|---|
| `EVOLUTION_URL` | `apps/api/.env` | `http://2.25.139.166:8085` |
| `EVOLUTION_API_KEY` | `apps/api/.env` | `EvolutionGo@2025Secure` |
| `WEBHOOK_SECRET` | `apps/api/.env` | random secret (set same in Evolution Go config) |
| `API_PUBLIC_URL` | `apps/api/.env` | `https://api.crmwhats.ammoc.org.br` (used to build webhook URL) |
| `NEXT_PUBLIC_API_URL` | `apps/web/.env.local` | `https://api.crmwhats.ammoc.org.br` (used by the web front-end to call the API) |

---

## 8. Out of Scope (this iteration)

- Group chats (only 1:1 JIDs handled)
- Media files in `.md` (images/audio/video stored as `[media]` placeholder)
- RAG indexing of `.md` files (covered by separate `agent_config` flow)
- Outbound messages from the system to WhatsApp
