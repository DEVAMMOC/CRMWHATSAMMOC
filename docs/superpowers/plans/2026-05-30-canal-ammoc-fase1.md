# Canal AMMOC — Fase 1 (Multi-número Meta Cloud API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber e responder mensagens de cidadãos pelos números oficiais da AMMOC (Meta WhatsApp Cloud API) num inbox único no CRM marcado por número, com delegação manual por setor/funcionário — suportando múltiplos números sob uma WABA. Sem bot/IA.

**Architecture:** Novo módulo `canal` na API NestJS (webhook público + endpoints autenticados + MetaService para Graph API). Tabelas `canal_config`/`canal_numbers`/`canal_conversations`/`canal_messages` no Supabase. Frontend com inbox split (`/canal`) e config (`/canal/config`). Reaproveita setores/delegação e o padrão do `ConversationPanel` já existentes.

**Tech Stack:** NestJS + Supabase (Postgres) + Meta Graph API v21.0 + Next.js 15 + TypeScript.

**Spec:** [docs/superpowers/specs/2026-05-30-canal-ammoc-fase1-multinumero-design.md](../specs/2026-05-30-canal-ammoc-fase1-multinumero-design.md)

**Padrões a espelhar (ler antes de implementar):**
- `apps/api/src/modules/sectors/` — shape de module/service/controller, provider `SUPABASE_CLIENT`, `AuthGuard`, `assertCanManage` (role admin/supervisor via tabela `users`).
- `apps/api/src/modules/whatsapp/webhook.controller.ts` — controller de webhook **público** (sem AuthGuard) já existente.
- `apps/api/src/modules/whatsapp/evolution.service.ts` — padrão de `fetch` a API externa.
- `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx` — painel de conversa (histórico + composer + poll 5s) a reaproveitar/adaptar.
- `apps/web/src/app/(app)/configuracoes/setores/page.tsx` — padrão de página de config (apiFetch + getApiBase + modal CRUD).

---

## File Structure

**Novos (API):**
- `apps/api/src/modules/canal/canal.module.ts`
- `apps/api/src/modules/canal/meta.service.ts` — Graph API: enviar texto, validar assinatura
- `apps/api/src/modules/canal/canal-config.service.ts` — config WABA + números
- `apps/api/src/modules/canal/canal-conversation.service.ts` — conversas/mensagens, delegar, encerrar
- `apps/api/src/modules/canal/canal-webhook.controller.ts` — GET verify + POST eventos (público)
- `apps/api/src/modules/canal/canal-config.controller.ts` — config + números (admin/supervisor)
- `apps/api/src/modules/canal/canal-inbox.controller.ts` — inbox autenticado
- `apps/api/src/modules/canal/dto/{save-config,add-number,send-message,delegate}.dto.ts`

**Novos (Web):**
- `apps/web/src/app/(app)/canal/page.tsx` — inbox split
- `apps/web/src/app/(app)/canal/CanalPanel.tsx` — painel de conversa do canal
- `apps/web/src/app/(app)/canal/config/page.tsx` — config WABA + números

**Modificados:**
- `apps/api/src/app.module.ts` — registrar `CanalModule`
- `packages/types/src/index.ts` — tipos do canal
- `apps/web/src/components/layout/Sidebar.tsx` — seção "Canal AMMOC"

---

### Task 1: Migration — tabelas do canal

**Files:** Migration via Supabase MCP (ref `xfqphbdurynuwvrnxpvj`).

- [ ] **Step 1: Aplicar migration**

`mcp__supabase__apply_migration` name `canal_ammoc_phase1`:
```sql
CREATE TABLE canal_config (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waba_id      text NOT NULL DEFAULT '',
  access_token text NOT NULL DEFAULT '',
  verify_token text NOT NULL DEFAULT '',
  app_secret   text NOT NULL DEFAULT '',
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE canal_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number_id text NOT NULL UNIQUE,
  display_number  text NOT NULL,
  label           text NOT NULL DEFAULT '',
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE canal_conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_number_id   uuid NOT NULL REFERENCES canal_numbers(id) ON DELETE CASCADE,
  wa_contact_number text NOT NULL,
  wa_contact_name   text,
  sector_id         uuid REFERENCES sectors(id) ON DELETE SET NULL,
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'open',
  last_in_at        timestamptz,
  last_message_at   timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  UNIQUE (canal_number_id, wa_contact_number)
);

CREATE TABLE canal_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES canal_conversations(id) ON DELETE CASCADE,
  direction       text NOT NULL,
  content         text NOT NULL,
  wa_message_id   text UNIQUE,
  sent_by         uuid REFERENCES users(id),
  sent_at         timestamptz DEFAULT now()
);

CREATE INDEX idx_canal_conv_status   ON canal_conversations(status);
CREATE INDEX idx_canal_conv_assigned ON canal_conversations(assigned_to);
CREATE INDEX idx_canal_conv_number   ON canal_conversations(canal_number_id);
CREATE INDEX idx_canal_msg_conv      ON canal_messages(conversation_id);

ALTER TABLE canal_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canal_numbers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE canal_messages      ENABLE ROW LEVEL SECURITY;

-- Config/numbers: admin/supervisor only (usa a função current_user_role() já existente)
CREATE POLICY canal_config_rw  ON canal_config  FOR ALL USING (current_user_role() = ANY (ARRAY['admin','supervisor']::user_role[]));
CREATE POLICY canal_numbers_rw ON canal_numbers FOR ALL USING (current_user_role() = ANY (ARRAY['admin','supervisor']::user_role[]));
-- Conversas: admin/supervisor tudo; funcionário só as suas
CREATE POLICY canal_conv_read ON canal_conversations FOR SELECT USING (
  current_user_role() = ANY (ARRAY['admin','supervisor']::user_role[]) OR assigned_to = auth.uid()
);
CREATE POLICY canal_msg_read ON canal_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM canal_conversations c WHERE c.id = canal_messages.conversation_id
    AND (current_user_role() = ANY (ARRAY['admin','supervisor']::user_role[]) OR c.assigned_to = auth.uid()))
);
```
NOTA: a API usa o service-role client (bypassa RLS) para webhook/escrita; as policies acima protegem leitura via client. Confirmar que `current_user_role()` e o enum `user_role` existem (usados em `messages_select`); se a assinatura diferir, espelhar exatamente o que `messages_select` usa.

- [ ] **Step 2: Verificar tabelas**

`mcp__supabase__execute_sql`:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'canal_%' ORDER BY 1;
```
Esperado: 4 linhas (canal_config, canal_conversations, canal_messages, canal_numbers).

- [ ] **Step 3: Commit nota**
```bash
git commit --allow-empty -m "feat: canal AMMOC phase1 tables (config, numbers, conversations, messages)"
```

---

### Task 2: Tipos compartilhados

**Files:** Modify `packages/types/src/index.ts`

- [ ] **Step 1: Adicionar ao final do arquivo**
```typescript
export interface CanalNumber {
  id: string;
  phone_number_id: string;
  display_number: string;
  label: string;
  active: boolean;
  created_at: string;
}

export type CanalConversationStatus = 'open' | 'human' | 'closed';

export interface CanalConversation {
  id: string;
  canal_number_id: string;
  wa_contact_number: string;
  wa_contact_name: string | null;
  sector_id: string | null;
  assigned_to: string | null;
  status: CanalConversationStatus;
  last_in_at: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface CanalMessage {
  id: string;
  conversation_id: string;
  direction: 'in' | 'out';
  content: string;
  wa_message_id: string | null;
  sent_by: string | null;
  sent_at: string;
}
```

- [ ] **Step 2: Build + commit**
```bash
pnpm --filter @crmwhats/types build
git add packages/types/src/index.ts
git commit -m "feat(types): add Canal AMMOC types"
```
Esperado: build exit 0.

---

### Task 3: MetaService (Graph API + assinatura)

**Files:** Create `apps/api/src/modules/canal/meta.service.ts`

- [ ] **Step 1: Implementar o serviço**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface MetaSendResult { ok: boolean; error?: string; wa_message_id?: string }

@Injectable()
export class MetaService {
  private readonly logger = new Logger(MetaService.name);
  constructor(private readonly supabase: SupabaseClient) {}

  private async config(): Promise<{ access_token: string; app_secret: string; verify_token: string } | null> {
    const { data } = await this.supabase.from('canal_config').select('access_token, app_secret, verify_token').limit(1).single();
    return (data as { access_token: string; app_secret: string; verify_token: string } | null) ?? null;
  }

  /** Webhook GET handshake: retorna o challenge se o verify_token bate. */
  async verifyChallenge(mode: string, token: string, challenge: string): Promise<string | null> {
    const cfg = await this.config();
    if (mode === 'subscribe' && cfg && token && token === cfg.verify_token) return challenge;
    return null;
  }

  /** Valida X-Hub-Signature-256 (sha256=<hmac do corpo cru com app_secret>). */
  async verifySignature(rawBody: Buffer, signatureHeader: string | undefined): Promise<boolean> {
    const cfg = await this.config();
    if (!cfg?.app_secret || !signatureHeader) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', cfg.app_secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Envia mensagem de texto pelo número (phone_number_id) informado. */
  async sendText(phoneNumberId: string, to: string, text: string): Promise<MetaSendResult> {
    const cfg = await this.config();
    if (!cfg?.access_token) return { ok: false, error: 'Canal não configurado (access_token ausente)' };
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } }),
    });
    const body = await res.json().catch(() => ({})) as { messages?: Array<{ id: string }>; error?: { message: string } };
    if (!res.ok) return { ok: false, error: body.error?.message ?? `Graph ${res.status}` };
    return { ok: true, wa_message_id: body.messages?.[0]?.id };
  }

  /** Testa o token chamando GET /{phone_number_id}. */
  async testConnection(phoneNumberId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.config();
    if (!cfg?.access_token) return { ok: false, error: 'access_token ausente' };
    const res = await fetch(`${GRAPH}/${phoneNumberId}`, { headers: { Authorization: `Bearer ${cfg.access_token}` } });
    if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: { message: string } }; return { ok: false, error: b.error?.message ?? `Graph ${res.status}` }; }
    return { ok: true };
  }
}
```

- [ ] **Step 2: (sem build isolado; compila na Task 7 com o módulo)**

---

### Task 4: CanalConversationService

**Files:** Create `apps/api/src/modules/canal/canal-conversation.service.ts`

- [ ] **Step 1: Implementar**

```typescript
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { MetaService } from './meta.service';

@Injectable()
export class CanalConversationService {
  private readonly logger = new Logger(CanalConversationService.name);
  constructor(private readonly supabase: SupabaseClient, private readonly meta: MetaService) {}

  /** Webhook inbound: cria/atualiza conversa e grava a mensagem recebida. */
  async ingestInbound(params: {
    phoneNumberId: string; from: string; name: string | null; waMessageId: string; content: string; tsISO: string;
  }): Promise<void> {
    const { data: num } = await this.supabase.from('canal_numbers').select('id, active').eq('phone_number_id', params.phoneNumberId).single();
    if (!num || !(num as { active: boolean }).active) { this.logger.warn(`Canal: número desconhecido/inativo ${params.phoneNumberId}`); return; }
    const numberId = (num as { id: string }).id;

    const { data: conv, error: convErr } = await this.supabase.from('canal_conversations').upsert({
      canal_number_id: numberId,
      wa_contact_number: params.from,
      wa_contact_name: params.name,
      last_in_at: params.tsISO,
      last_message_at: params.tsISO,
      // status: omitido — INSERT usa default 'open'; em conflito não reseta delegação.
      // Reabrir se estava 'closed' é feito abaixo.
    }, { onConflict: 'canal_number_id,wa_contact_number', ignoreDuplicates: false }).select('id, status').single();
    if (convErr || !conv) { this.logger.error(`Canal: erro upsert conversa: ${convErr?.message}`); return; }
    const c = conv as { id: string; status: string };
    if (c.status === 'closed') {
      await this.supabase.from('canal_conversations').update({ status: 'open' }).eq('id', c.id);
    }
    await this.supabase.from('canal_messages').upsert({
      conversation_id: c.id, direction: 'in', content: params.content || '[mídia]', wa_message_id: params.waMessageId, sent_at: params.tsISO,
    }, { onConflict: 'wa_message_id', ignoreDuplicates: true });
  }

  async list(): Promise<unknown[]> {
    const { data } = await this.supabase.from('canal_conversations').select('*, canal_numbers(label, display_number)').order('last_message_at', { ascending: false });
    return data ?? [];
  }

  async messages(conversationId: string): Promise<unknown[]> {
    const { data } = await this.supabase.from('canal_messages').select('*').eq('conversation_id', conversationId).order('sent_at', { ascending: true });
    return data ?? [];
  }

  /** Funcionário/admin responde pela inbox → envia via Meta e grava 'out'. */
  async reply(conversationId: string, userId: string, text: string): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('id, wa_contact_number, last_in_at, canal_numbers(phone_number_id)')
      .eq('id', conversationId).single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const cc = conv as unknown as { wa_contact_number: string; last_in_at: string | null; canal_numbers: { phone_number_id: string } };

    // Janela de 24h da Meta para mensagens livres.
    if (!cc.last_in_at || (Date.now() - new Date(cc.last_in_at).getTime()) > 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Fora da janela de 24h da Meta — requer template aprovado (indisponível na Fase 1).');
    }
    const result = await this.meta.sendText(cc.canal_numbers.phone_number_id, cc.wa_contact_number, text);
    if (!result.ok) throw new BadRequestException(result.error ?? 'Falha ao enviar pela Meta');
    const now = new Date().toISOString();
    await this.supabase.from('canal_messages').insert({ conversation_id: conversationId, direction: 'out', content: text, wa_message_id: result.wa_message_id ?? null, sent_by: userId, sent_at: now });
    await this.supabase.from('canal_conversations').update({ last_message_at: now, status: 'human' }).eq('id', conversationId);
  }

  async delegate(conversationId: string, sectorId: string | null, assignedTo: string | null): Promise<void> {
    const { error } = await this.supabase.from('canal_conversations').update({
      sector_id: sectorId, assigned_to: assignedTo, status: 'human',
    }).eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
  }

  async close(conversationId: string): Promise<void> {
    await this.supabase.from('canal_conversations').update({ status: 'closed' }).eq('id', conversationId);
  }
}
```

---

### Task 5: CanalConfigService + DTOs

**Files:** Create `apps/api/src/modules/canal/canal-config.service.ts` e os DTOs em `apps/api/src/modules/canal/dto/`.

- [ ] **Step 1: DTOs**

`save-config.dto.ts`:
```typescript
import { IsString, IsOptional } from 'class-validator';
export class SaveConfigDto {
  @IsString() @IsOptional() wabaId?: string;
  @IsString() @IsOptional() accessToken?: string;
  @IsString() @IsOptional() verifyToken?: string;
  @IsString() @IsOptional() appSecret?: string;
}
```
`add-number.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
export class AddNumberDto {
  @IsString() @IsNotEmpty() phoneNumberId!: string;
  @IsString() @IsNotEmpty() displayNumber!: string;
  @IsString() @IsOptional() label?: string;
}
```
`send-message.dto.ts`:
```typescript
import { IsString, IsNotEmpty } from 'class-validator';
export class CanalSendMessageDto { @IsString() @IsNotEmpty() text!: string; }
```
`delegate.dto.ts`:
```typescript
import { IsUUID, IsOptional } from 'class-validator';
export class CanalDelegateDto {
  @IsUUID() @IsOptional() sectorId?: string;
  @IsUUID() @IsOptional() assignedTo?: string;
}
```

- [ ] **Step 2: CanalConfigService**

```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { SaveConfigDto } from './dto/save-config.dto';

const mask = (s: string) => (s && s.length > 4 ? '••••' + s.slice(-4) : (s ? '••••' : ''));

@Injectable()
export class CanalConfigService {
  constructor(private readonly supabase: SupabaseClient) {}

  async get(): Promise<{ wabaId: string; accessToken: string; verifyToken: string; appSecret: string; numbers: unknown[] }> {
    const { data: cfg } = await this.supabase.from('canal_config').select('*').limit(1).single();
    const { data: numbers } = await this.supabase.from('canal_numbers').select('*').order('created_at');
    const c = (cfg as { waba_id: string; access_token: string; verify_token: string; app_secret: string } | null);
    return {
      wabaId: c?.waba_id ?? '',
      accessToken: mask(c?.access_token ?? ''),   // mascarado — nunca retorna o token cru
      verifyToken: c?.verify_token ?? '',
      appSecret: mask(c?.app_secret ?? ''),
      numbers: numbers ?? [],
    };
  }

  async save(dto: SaveConfigDto): Promise<void> {
    const { data: existing } = await this.supabase.from('canal_config').select('id').limit(1).single();
    // Só atualiza campos enviados (não sobrescreve segredo com vazio/mascarado).
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.wabaId !== undefined) patch['waba_id'] = dto.wabaId;
    if (dto.verifyToken !== undefined) patch['verify_token'] = dto.verifyToken;
    if (dto.accessToken && !dto.accessToken.startsWith('••••')) patch['access_token'] = dto.accessToken;
    if (dto.appSecret && !dto.appSecret.startsWith('••••')) patch['app_secret'] = dto.appSecret;
    if (existing) await this.supabase.from('canal_config').update(patch).eq('id', (existing as { id: string }).id);
    else await this.supabase.from('canal_config').insert(patch);
  }

  async addNumber(phoneNumberId: string, displayNumber: string, label: string): Promise<void> {
    await this.supabase.from('canal_numbers').upsert({ phone_number_id: phoneNumberId, display_number: displayNumber, label }, { onConflict: 'phone_number_id', ignoreDuplicates: false });
  }

  async removeNumber(id: string): Promise<void> {
    await this.supabase.from('canal_numbers').delete().eq('id', id);
  }
}
```

---

### Task 6: Controllers (webhook público + config + inbox)

**Files:** Create `canal-webhook.controller.ts`, `canal-config.controller.ts`, `canal-inbox.controller.ts`.

- [ ] **Step 1: Webhook controller (público — sem AuthGuard)**

`canal-webhook.controller.ts`:
```typescript
import { Controller, Get, Post, Query, Req, Res, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { MetaService } from './meta.service';
import { CanalConversationService } from './canal-conversation.service';

@Controller('canal/webhook')
export class CanalWebhookController {
  private readonly logger = new Logger(CanalWebhookController.name);
  constructor(private readonly meta: MetaService, private readonly convs: CanalConversationService) {}

  @Get()
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    const ok = await this.meta.verifyChallenge(mode, token, challenge);
    if (ok) return res.status(200).send(ok);
    return res.status(403).send('forbidden');
  }

  @Post()
  async receive(@Req() req: Request, @Res() res: Response) {
    // Requer o corpo CRU para validar a assinatura — ver nota de bootstrap abaixo.
    const raw: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const sig = req.header('x-hub-signature-256');
    if (!(await this.meta.verifySignature(raw, sig))) { this.logger.warn('Canal webhook: assinatura inválida'); return res.status(401).send('invalid signature'); }

    const body = req.body as { entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }> };
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = (change.value ?? {}) as { metadata?: { phone_number_id?: string }; contacts?: Array<{ profile?: { name?: string } }>; messages?: Array<{ from: string; id: string; timestamp: string; type: string; text?: { body: string } }> };
        const phoneNumberId = value.metadata?.phone_number_id ?? '';
        const name = value.contacts?.[0]?.profile?.name ?? null;
        for (const m of value.messages ?? []) {
          const content = m.type === 'text' ? (m.text?.body ?? '') : '[mídia]';
          const tsISO = new Date(Number(m.timestamp) * 1000).toISOString();
          await this.convs.ingestInbound({ phoneNumberId, from: m.from, name, waMessageId: m.id, content, tsISO });
        }
      }
    }
    return res.status(200).send('ok'); // sempre 200 rápido p/ a Meta não reenviar
  }
}
```
NOTA DE BOOTSTRAP (rawBody): para validar `X-Hub-Signature-256` é preciso o corpo cru. Em `apps/api/src/main.ts`, configurar o body parser para reter o raw body, ex.: `app.use(json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }))` (importar `json` de `express`). Implementar isso nesta task e confirmar que não quebra os outros controllers (eles continuam lendo `req.body` normalmente).

- [ ] **Step 2: Config controller (admin/supervisor)**

`canal-config.controller.ts` — usa `AuthGuard` + checagem de role (espelhar `assertCanManage` do SectorsService/Controller: carregar role do usuário via tabela `users` e exigir admin/supervisor):
```typescript
import { Controller, Get, Put, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanalConfigService } from './canal-config.service';
import { MetaService } from './meta.service';
import { SaveConfigDto } from './dto/save-config.dto';
import { AddNumberDto } from './dto/add-number.dto';

@Controller('canal')
@UseGuards(AuthGuard)
export class CanalConfigController {
  constructor(private readonly config: CanalConfigService, private readonly meta: MetaService) {}
  // NOTA: aplicar a mesma checagem de role admin/supervisor usada nos setores antes de cada mutação.

  @Get('config') get() { return this.config.get(); }
  @Put('config') save(@CurrentUser() _u: User, @Body() dto: SaveConfigDto) { return this.config.save(dto); }
  @Post('numbers') add(@CurrentUser() _u: User, @Body() dto: AddNumberDto) { return this.config.addNumber(dto.phoneNumberId, dto.displayNumber, dto.label ?? ''); }
  @Delete('numbers/:id') remove(@CurrentUser() _u: User, @Param('id') id: string) { return this.config.removeNumber(id); }
  @Post('test-connection') async test(@Body() body: { phoneNumberId: string }) { return this.meta.testConnection(body.phoneNumberId); }
}
```
NOTA: confirmar o caminho real de `AuthGuard`/`CurrentUser` e o mecanismo de role (igual aos setores). Aplicar o `assertCanManage(user.id)` (ou equivalente) nas rotas de mutação.

- [ ] **Step 3: Inbox controller (autenticado)**

`canal-inbox.controller.ts`:
```typescript
import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanalConversationService } from './canal-conversation.service';
import { CanalSendMessageDto } from './dto/send-message.dto';
import { CanalDelegateDto } from './dto/delegate.dto';

@Controller('canal/conversations')
@UseGuards(AuthGuard)
export class CanalInboxController {
  constructor(private readonly convs: CanalConversationService) {}
  @Get() list() { return this.convs.list(); }
  @Get(':id/messages') messages(@Param('id') id: string) { return this.convs.messages(id); }
  @Post(':id/message') reply(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: CanalSendMessageDto) { return this.convs.reply(id, user.id, dto.text); }
  @Post(':id/delegate') delegate(@Param('id') id: string, @Body() dto: CanalDelegateDto) { return this.convs.delegate(id, dto.sectorId ?? null, dto.assignedTo ?? null); }
  @Post(':id/close') close(@Param('id') id: string) { return this.convs.close(id); }
}
```

---

### Task 7: CanalModule + registro no AppModule

**Files:** Create `canal.module.ts`; Modify `apps/api/src/app.module.ts`.

- [ ] **Step 1: Module** (espelhar `SectorsModule` — provider `SUPABASE_CLIENT` via factory com `supabase.url`/`supabase.serviceRoleKey`, `AuthModule` import; instanciar os serviços com o client):
```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { MetaService } from './meta.service';
import { CanalConfigService } from './canal-config.service';
import { CanalConversationService } from './canal-conversation.service';
import { CanalWebhookController } from './canal-webhook.controller';
import { CanalConfigController } from './canal-config.controller';
import { CanalInboxController } from './canal-inbox.controller';

@Module({
  imports: [AuthModule],
  providers: [
    { provide: 'SUPABASE_CLIENT', inject: [ConfigService], useFactory: (c: ConfigService) => createClient(c.getOrThrow('supabase.url'), c.getOrThrow('supabase.serviceRoleKey')) },
    { provide: MetaService, inject: ['SUPABASE_CLIENT'], useFactory: (s: ReturnType<typeof createClient>) => new MetaService(s) },
    { provide: CanalConfigService, inject: ['SUPABASE_CLIENT'], useFactory: (s: ReturnType<typeof createClient>) => new CanalConfigService(s) },
    { provide: CanalConversationService, inject: ['SUPABASE_CLIENT', MetaService], useFactory: (s: ReturnType<typeof createClient>, m: MetaService) => new CanalConversationService(s, m) },
  ],
  controllers: [CanalWebhookController, CanalConfigController, CanalInboxController],
})
export class CanalModule {}
```
NOTA: confirmar os nomes das config keys (`supabase.url`/`supabase.serviceRoleKey`) iguais aos do SectorsModule.

- [ ] **Step 2: Registrar no AppModule** — adicionar `CanalModule` ao array `imports` de `apps/api/src/app.module.ts` (importar no topo).

- [ ] **Step 3: Bootstrap rawBody** — em `apps/api/src/main.ts`, reter o corpo cru (ver NOTA da Task 6 Step 1).

- [ ] **Step 4: Build**
```bash
pnpm --filter @crmwhats/api build
```
Esperado: exit 0.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/canal/ apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(api): Canal AMMOC module — Meta webhook, inbox, config (phase 1)"
```

---

### Task 8: Frontend — /canal/config

**Files:** Create `apps/web/src/app/(app)/canal/config/page.tsx`

- [ ] **Step 1: Página de config** — client component, padrão da página de setores (`getApiBase` de `@/lib/api-base`, token via `supabase.auth.getSession()`, `apiFetch`). Conteúdo:
  - Form WABA: WABA ID, Access Token (input password, placeholder mostra mascarado vindo do GET; só envia se o usuário digitar novo), Verify Token, App Secret. Botão "Salvar" → `PUT /api/canal/config`.
  - Botão "Testar conexão" por número → `POST /api/canal/test-connection {phoneNumberId}` → mostra ok/erro.
  - Lista de números (de `GET /api/canal/config` → `numbers`): cada um com label, display_number, phone_number_id, botão remover (`DELETE /api/canal/numbers/:id`). Form "Adicionar número": phoneNumberId, displayNumber, label → `POST /api/canal/numbers`.
  - Bloco "Como configurar na Meta" (texto estático): URL do webhook `https://crm.ammoc.org.br/api/canal/webhook`, inscrever evento `messages`, informar o Verify Token salvo.
  - Usar as variáveis CSS `--ammoc-*` e o estilo das outras páginas de config.

- [ ] **Step 2: tsc**
```bash
cd apps/web && npx tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 3: Commit**
```bash
git add "apps/web/src/app/(app)/canal/config/page.tsx"
git commit -m "feat(web): /canal/config — Meta WABA credentials + numbers CRUD"
```

---

### Task 9: Frontend — /canal inbox (split) + CanalPanel

**Files:** Create `apps/web/src/app/(app)/canal/page.tsx` e `apps/web/src/app/(app)/canal/CanalPanel.tsx`

- [ ] **Step 1: CanalPanel.tsx** — adaptar de `apps/web/src/app/(app)/meu-numero/ConversationPanel.tsx`:
  - Props: `conversationId`, `contactName`, `contactNumber`, `numberLabel`, `status`, `token`, `onBack?`, `onChanged?`.
  - Carrega mensagens via `GET /api/canal/conversations/:id/messages` (apiFetch + getApiBase), poll 5s, bolhas in/out, auto-scroll.
  - Composer: envia via `POST /api/canal/conversations/:id/message {text}`; em erro 400 de janela 24h, mostra o aviso retornado e desabilita o envio.
  - Cabeçalho: nome/numero + badge do `numberLabel` + status; botões "Delegar" (modal setor/funcionário, reaproveitar a lógica do modal de delegação existente em `conversa/[id]`) e "Encerrar" (`POST /api/canal/conversations/:id/close`).

- [ ] **Step 2: page.tsx** — split 2 colunas (mesma estrutura do `meu-numero` conversas tab):
  - Esquerda: lista de `GET /api/canal/conversations` com badge de número (label), setor, status; filtros Todas/Aguardando(open)/Em atendimento(human)/Encerradas(closed); busca; onClick seleciona.
  - Direita: `<CanalPanel>` da conversa selecionada, ou estado vazio.

- [ ] **Step 3: tsc**
```bash
cd apps/web && npx tsc --noEmit
```
Esperado: sem erros.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/app/(app)/canal/page.tsx" "apps/web/src/app/(app)/canal/CanalPanel.tsx"
git commit -m "feat(web): /canal inbox split + CanalPanel (history, reply, delegate, close)"
```

---

### Task 10: Sidebar — seção Canal AMMOC

**Files:** Modify `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1:** Adicionar uma seção "Canal AMMOC" (visível a admin/supervisor, como `ADMIN_NAV`) com:
```typescript
{ icon: '📡', label: 'Canal AMMOC', href: '/canal' },
{ icon: '⚙️', label: 'Canal — Config', href: '/canal/config' },
```
Seguir o padrão das seções existentes (ex.: como `Setores`/`Painel Admin` são gateados por role).

- [ ] **Step 2: tsc + commit**
```bash
cd apps/web && npx tsc --noEmit
git add "apps/web/src/components/layout/Sidebar.tsx"
git commit -m "feat(web): sidebar — Canal AMMOC links"
```

---

### Task 11: Deploy + verificação

- [ ] **Step 1: Push + deploy**
```bash
git push origin master
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=pp6qewlm9usx4rqroaxzi042&force=false" -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=y664pro58rjywtieei0no3ua&force=false" -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
```

- [ ] **Step 2: Verificar endpoints**
  - `GET https://crm.ammoc.org.br/api/canal/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123` → **403** (sem config/token errado).
  - `GET https://crm.ammoc.org.br/api/canal/conversations` (sem auth) → **401**.
  - Web: `https://crm.ammoc.org.br/canal` e `/canal/config` carregam (302→login se deslogado).

- [ ] **Step 3: Smoke (após o admin verificar um número na Meta)**
  - Em `/canal/config`: salvar WABA ID, Access Token, Verify Token, App Secret; adicionar um número (phone_number_id + display).
  - No portal Meta: configurar o webhook (`/api/canal/webhook`, evento `messages`, mesmo Verify Token) → o GET de verificação deve retornar o challenge (200).
  - Enviar uma mensagem de um celular para o número AMMOC → aparece em `/canal`; responder pela inbox dentro de 24h → cidadão recebe.

---

## Self-Review

**Cobertura da spec:**
- ✅ Tabelas multi-número (Task 1)
- ✅ Tipos (Task 2)
- ✅ Meta send + verify challenge + signature (Task 3)
- ✅ Ingest inbound + reply (24h) + delegate + close (Task 4)
- ✅ Config WABA + números CRUD + mascaramento de segredo (Task 5)
- ✅ Webhook público (GET verify + POST assinado) + config + inbox controllers (Task 6)
- ✅ Module + registro + rawBody bootstrap (Task 7)
- ✅ Frontend config (Task 8) e inbox split marcado por número (Task 9)
- ✅ Sidebar (Task 10)
- ✅ Deploy + verificação (Task 11)
- ✅ Janela 24h tratada (Task 4 reply)
- ✅ RLS admin/supervisor + funcionário (Task 1)

**Placeholders:** as Tasks 8/9 descrevem páginas de UML com referência ao padrão existente em vez de reproduzir ~400 linhas verbatim — durante a execução (subagent-driven) cada implementer recebe o código/al padrão exato a espelhar (ConversationPanel, página de setores). Backend tem código completo nas partes não-triviais.

**Consistência:** rotas `/api/canal/*` e payloads consistentes entre controllers (Task 6) e frontend (Tasks 8/9). `phone_number_id`/`canal_number_id` consistentes entre Task 1 (schema), Task 4 (service) e Task 6 (webhook). Status `open|human|closed` consistente (Task 1, 2, 4).

**Fora de escopo (Fase 1):** bot/IA, bridge Evolution↔Meta, templates/HSM, mídia, criptografia em repouso (mascaramento + RLS por ora).
