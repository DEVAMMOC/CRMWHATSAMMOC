# WhatsApp Connection & Conversation Sharing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each funcionário to connect their WhatsApp via Evolution Go, receive messages in real time, and selectively share conversations with the organization (saved to DB + `.md` file).

**Architecture:** NestJS `WhatsAppModule` wraps the Evolution Go HTTP API (EvolutionService), exposes REST endpoints for connect/QR/pair/status/disconnect, and a webhook endpoint that receives events and persists messages. A `ContextService` generates `.md` files when a conversation is shared. The `/meu-numero` front-end page is rebuilt with two tabs: Connection and Conversas.

**Tech Stack:** NestJS 11 (native fetch, no extra HTTP lib), Supabase service-role client, Next.js 15 App Router, Evolution Go API at `http://2.25.139.166:8085`.

---

## File Map

### New — API (`apps/api/src/modules/whatsapp/`)
- `evolution.service.ts` — HTTP client wrapping Evolution Go API
- `evolution.service.spec.ts`
- `whatsapp.service.ts` — connect/disconnect business logic
- `whatsapp.service.spec.ts`
- `whatsapp.controller.ts` — `/api/whatsapp/*` endpoints
- `webhook.service.ts` — processes MESSAGE + connection.update events
- `webhook.service.spec.ts`
- `webhook.controller.ts` — `POST /api/webhook/whatsapp`
- `context.service.ts` — generates .md from conversation messages
- `context.service.spec.ts`
- `conversation-share.controller.ts` — `POST /api/conversations/:id/share`
- `whatsapp.module.ts` — registers everything
- `dto/pair.dto.ts` — DTO for pairing code request

### Modified — API
- `apps/api/src/config/configuration.ts` — add `apiPublicUrl`
- `apps/api/src/app.module.ts` — import `WhatsAppModule`

### New — DB
- `supabase/migrations/20260529000001_whatsapp_connection.sql`

### Modified — Types
- `packages/types/src/index.ts` — add `whatsapp_status` to `AppUser`, add `shared_at`/`shared_by` to `Conversation`

### Modified — Web
- `apps/web/src/app/(app)/meu-numero/page.tsx` — full rebuild (Connection tab + Conversas tab)

---

## Task 1: Database Migration + Type Updates

**Files:**
- Create: `supabase/migrations/20260529000001_whatsapp_connection.sql`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Write migration file**

```sql
-- supabase/migrations/20260529000001_whatsapp_connection.sql
-- WhatsApp connection feature — schema additions

-- 1. Add whatsapp_status to users
ALTER TABLE public.users
  ADD COLUMN whatsapp_status text NOT NULL DEFAULT 'disconnected';

-- 2. Add sharing columns to conversations
ALTER TABLE public.conversations
  ADD COLUMN shared_at  timestamptz,
  ADD COLUMN shared_by  uuid REFERENCES public.users(id);

-- 3. Add content column to context_files (stores .md text)
ALTER TABLE public.context_files
  ADD COLUMN content text;

-- 4. Add unique constraint so upsert works on (conversation_id, file_type)
ALTER TABLE public.context_files
  ADD CONSTRAINT context_files_conv_type_unique
  UNIQUE (conversation_id, file_type);

-- 5. RLS: owner can see their own context files
CREATE POLICY "context_files_owner_select" ON public.context_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.owner_user_id = auth.uid()
    )
    OR public.current_user_role() IN ('supervisor', 'admin')
  );

-- 6. Service-role bypass is automatic; no extra policy needed for webhook inserts.
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use the `mcp__supabase__apply_migration` tool with:
- `project_id: "xfqphbdurynuwvrnxpvj"`
- `name: "whatsapp_connection"`
- `query`: paste the full SQL above

Expected: migration applies without error.

- [ ] **Step 3: Update shared types**

Replace `AppUser` and `Conversation` in `packages/types/src/index.ts`:

```typescript
export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  whatsapp_number: string | null;
  evolution_instance_id: string | null;
  evolution_instance_token: string | null;
  whatsapp_status: 'disconnected' | 'connecting' | 'connected';
  is_online: boolean;
  created_at: string;
}

export interface Conversation {
  id: string;
  owner_user_id: string;
  contact_number: string;
  contact_name: string;
  status: ConversationStatus;
  source: ConversationSource;
  municipality: string | null;
  trigger_keywords: string[];
  last_message_at: string | null;
  last_synced_at: string | null;
  shared_at: string | null;
  shared_by: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260529000001_whatsapp_connection.sql packages/types/src/index.ts
git commit -m "feat: migration + types for whatsapp connection"
```

---

## Task 2: EvolutionService

**Files:**
- Create: `apps/api/src/modules/whatsapp/evolution.service.ts`
- Create: `apps/api/src/modules/whatsapp/evolution.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/api/src/modules/whatsapp/evolution.service.spec.ts
import { EvolutionService } from './evolution.service';
import { ConfigService } from '@nestjs/config';

const mockConfig = {
  getOrThrow: (key: string) => {
    if (key === 'evolution.url') return 'http://evo:8085';
    if (key === 'evolution.apiKey') return 'test-key';
    throw new Error(`Unknown key: ${key}`);
  },
} as unknown as ConfigService;

describe('EvolutionService', () => {
  let service: EvolutionService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new EvolutionService(mockConfig);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'inst-1', name: 'user-abc' }),
      text: () => Promise.resolve(''),
    } as unknown as Response);
  });

  afterEach(() => { fetchSpy.mockRestore(); });

  it('createInstance posts to /instance/create with apikey header', async () => {
    const result = await service.createInstance('user-abc', 'token-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/create',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'test-key' }),
        body: JSON.stringify({ name: 'user-abc', token: 'token-123' }),
      }),
    );
    expect(result).toEqual({ id: 'inst-1', name: 'user-abc' });
  });

  it('getQR sends token header', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ base64: 'data:image/png;base64,abc' }),
    } as unknown as Response);
    const result = await service.getQR('tok-1');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://evo:8085/instance/qr',
      expect.objectContaining({
        headers: expect.objectContaining({ token: 'tok-1' }),
      }),
    );
    expect(result.base64).toBe('data:image/png;base64,abc');
  });

  it('throws when response is not ok', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    } as unknown as Response);
    await expect(service.createInstance('n', 't')).rejects.toThrow('Evolution create failed');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test -- --testPathPattern="evolution.service"
```

Expected: `Cannot find module './evolution.service'`

- [ ] **Step 3: Implement EvolutionService**

```typescript
// apps/api/src/modules/whatsapp/evolution.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EvolutionService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('evolution.url');
    this.apiKey  = config.getOrThrow<string>('evolution.apiKey');
  }

  private headers(token?: string): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
    };
    if (token) h['token'] = token;
    return h;
  }

  async createInstance(name: string, token: string): Promise<{ id: string; name: string }> {
    const res = await fetch(`${this.baseUrl}/instance/create`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ name, token }),
    });
    if (!res.ok) throw new Error(`Evolution create failed: ${await res.text()}`);
    return res.json() as Promise<{ id: string; name: string }>;
  }

  async connectInstance(token: string, webhookUrl: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/connect`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({
        webhookUrl,
        subscribe: ['MESSAGE', 'connection.update'],
        immediate: true,
      }),
    });
    if (!res.ok) throw new Error(`Evolution connect failed: ${await res.text()}`);
  }

  async getQR(token: string): Promise<{ base64: string }> {
    const res = await fetch(`${this.baseUrl}/instance/qr`, {
      headers: this.headers(token),
    });
    if (!res.ok) throw new Error(`Evolution QR failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    // Evolution Go may return { code } or { base64 }
    const base64 = (data['base64'] ?? data['code'] ?? '') as string;
    return { base64 };
  }

  async pairInstance(token: string, phone: string): Promise<{ code: string }> {
    const res = await fetch(`${this.baseUrl}/instance/pair`, {
      method: 'POST',
      headers: this.headers(token),
      body: JSON.stringify({ phone, subscribe: ['MESSAGE', 'connection.update'] }),
    });
    if (!res.ok) throw new Error(`Evolution pair failed: ${await res.text()}`);
    const data = await res.json() as Record<string, unknown>;
    return { code: (data['code'] ?? data['pairingCode'] ?? '') as string };
  }

  async getStatus(token: string): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/instance/status`, {
      headers: this.headers(token),
    });
    if (!res.ok) throw new Error(`Evolution status failed: ${res.status}`);
    const data = await res.json() as Record<string, unknown>;
    return { status: (data['status'] ?? data['state'] ?? 'unknown') as string };
  }

  async deleteInstance(instanceId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/instance/delete/${instanceId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Evolution delete failed: ${res.status}`);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd apps/api && pnpm test -- --testPathPattern="evolution.service"
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/whatsapp/
git commit -m "feat: EvolutionService — HTTP client for Evolution Go API"
```

---

## Task 3: WhatsApp Service + Controller (connect / QR / pair / status / disconnect)

**Files:**
- Create: `apps/api/src/modules/whatsapp/dto/pair.dto.ts`
- Create: `apps/api/src/modules/whatsapp/whatsapp.service.ts`
- Create: `apps/api/src/modules/whatsapp/whatsapp.service.spec.ts`
- Create: `apps/api/src/modules/whatsapp/whatsapp.controller.ts`

- [ ] **Step 1: Create PairDto**

```typescript
// apps/api/src/modules/whatsapp/dto/pair.dto.ts
import { IsString, Matches } from 'class-validator';

export class PairDto {
  @IsString()
  @Matches(/^\d{10,15}$/, { message: 'phone must be digits only, 10-15 chars (e.g. 5547999999999)' })
  phone: string;
}
```

- [ ] **Step 2: Write failing WhatsApp service tests**

```typescript
// apps/api/src/modules/whatsapp/whatsapp.service.spec.ts
import { WhatsAppService } from './whatsapp.service';
import { EvolutionService } from './evolution.service';
import { SupabaseClient } from '@supabase/supabase-js';

const makeSupabase = () => {
  const single = jest.fn().mockResolvedValue({ data: null, error: null });
  const update = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  const select = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single }) });
  const from   = jest.fn().mockReturnValue({ select, update });
  return { from } as unknown as SupabaseClient;
};

const makeEvolution = () => ({
  createInstance: jest.fn().mockResolvedValue({ id: 'inst-1', name: 'user-abc' }),
  connectInstance: jest.fn().mockResolvedValue(undefined),
  getQR:           jest.fn().mockResolvedValue({ base64: 'data:image/png;base64,QR' }),
  pairInstance:    jest.fn().mockResolvedValue({ code: '12345678' }),
  getStatus:       jest.fn().mockResolvedValue({ status: 'open' }),
  deleteInstance:  jest.fn().mockResolvedValue(undefined),
} as unknown as EvolutionService);

describe('WhatsAppService', () => {
  let service: WhatsAppService;
  let evo: ReturnType<typeof makeEvolution>;
  let supa: SupabaseClient;

  beforeEach(() => {
    evo  = makeEvolution();
    supa = makeSupabase();
    service = new WhatsAppService(evo, supa, 'http://api.test');
  });

  it('connect: creates instance and calls connectInstance', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { evolution_instance_token: null, evolution_instance_id: null }, error: null }),
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    });
    await service.connect('user-1');
    expect(evo.createInstance).toHaveBeenCalled();
    expect(evo.connectInstance).toHaveBeenCalled();
  });

  it('getQR: fetches QR from EvolutionService using stored token', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { evolution_instance_token: 'tok-1', evolution_instance_id: 'inst-1' }, error: null }),
        }),
      }),
    });
    const result = await service.getQR('user-1');
    expect(evo.getQR).toHaveBeenCalledWith('tok-1');
    expect(result.base64).toBe('data:image/png;base64,QR');
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd apps/api && pnpm test -- --testPathPattern="whatsapp.service"
```

Expected: `Cannot find module './whatsapp.service'`

- [ ] **Step 4: Implement WhatsAppService**

```typescript
// apps/api/src/modules/whatsapp/whatsapp.service.ts
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { EvolutionService } from './evolution.service';

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly evolution: EvolutionService,
    private readonly supabase: SupabaseClient,
    private readonly apiPublicUrl: string,
  ) {}

  private async getUserRow(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('evolution_instance_id, evolution_instance_token, whatsapp_status')
      .eq('id', userId)
      .single();
    if (error) throw new Error(error.message);
    return data as {
      evolution_instance_id: string | null;
      evolution_instance_token: string | null;
      whatsapp_status: string;
    };
  }

  async connect(userId: string): Promise<void> {
    const user = await this.getUserRow(userId);

    // Reuse existing token or create new one
    const token = user.evolution_instance_token ?? crypto.randomUUID();
    const instanceName = `user-${userId}`;

    let instanceId = user.evolution_instance_id;
    if (!instanceId) {
      const result = await this.evolution.createInstance(instanceName, token);
      instanceId = result.id ?? result.name ?? instanceName;
    }

    // Persist token + instanceId before connecting (so we can handle webhook)
    const { error: updateError } = await this.supabase
      .from('users')
      .update({
        evolution_instance_id: instanceId,
        evolution_instance_token: token,
        whatsapp_status: 'connecting',
      })
      .eq('id', userId);
    if (updateError) throw new Error(updateError.message);

    // Webhook URL includes token as query param so we can identify the user
    const webhookUrl = `${this.apiPublicUrl}/api/webhook/whatsapp?token=${token}`;
    await this.evolution.connectInstance(token, webhookUrl);
  }

  async getQR(userId: string): Promise<{ base64: string }> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp not connected');
    return this.evolution.getQR(user.evolution_instance_token);
  }

  async pair(userId: string, phone: string): Promise<{ code: string }> {
    const user = await this.getUserRow(userId);
    if (!user.evolution_instance_token) throw new BadRequestException('WhatsApp not connected');
    return this.evolution.pairInstance(user.evolution_instance_token, phone);
  }

  async getStatus(userId: string): Promise<{ status: string; instanceId: string | null }> {
    const user = await this.getUserRow(userId);
    return {
      status: user.whatsapp_status,
      instanceId: user.evolution_instance_id,
    };
  }

  async disconnect(userId: string): Promise<void> {
    const user = await this.getUserRow(userId);
    if (user.evolution_instance_id) {
      try {
        await this.evolution.deleteInstance(user.evolution_instance_id);
      } catch {
        // Best-effort: clear DB even if Evolution Go fails
      }
    }
    await this.supabase
      .from('users')
      .update({
        evolution_instance_id: null,
        evolution_instance_token: null,
        whatsapp_status: 'disconnected',
      })
      .eq('id', userId);
  }
}
```

- [ ] **Step 5: Implement WhatsAppController**

```typescript
// apps/api/src/modules/whatsapp/whatsapp.controller.ts
import {
  Controller, Post, Get, Delete, Body, UseGuards,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WhatsAppService } from './whatsapp.service';
import { PairDto } from './dto/pair.dto';

@Controller('whatsapp')
@UseGuards(AuthGuard)
export class WhatsAppController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Post('connect')
  async connect(@CurrentUser() user: User) {
    await this.whatsapp.connect(user.id);
    return { status: 'connecting' };
  }

  @Get('qr')
  getQR(@CurrentUser() user: User) {
    return this.whatsapp.getQR(user.id);
  }

  @Post('pair')
  pair(@CurrentUser() user: User, @Body() dto: PairDto) {
    return this.whatsapp.pair(user.id, dto.phone);
  }

  @Get('status')
  getStatus(@CurrentUser() user: User) {
    return this.whatsapp.getStatus(user.id);
  }

  @Delete('disconnect')
  async disconnect(@CurrentUser() user: User) {
    await this.whatsapp.disconnect(user.id);
    return { status: 'disconnected' };
  }
}
```

- [ ] **Step 6: Run service tests — expect PASS**

```bash
cd apps/api && pnpm test -- --testPathPattern="whatsapp.service"
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/whatsapp/
git commit -m "feat: WhatsAppService + WhatsAppController (connect/QR/pair/status/disconnect)"
```

---

## Task 4: WebhookService + WebhookController

**Files:**
- Create: `apps/api/src/modules/whatsapp/webhook.service.ts`
- Create: `apps/api/src/modules/whatsapp/webhook.service.spec.ts`
- Create: `apps/api/src/modules/whatsapp/webhook.controller.ts`

- [ ] **Step 1: Write failing webhook service tests**

```typescript
// apps/api/src/modules/whatsapp/webhook.service.spec.ts
import { WebhookService } from './webhook.service';
import { SupabaseClient } from '@supabase/supabase-js';

const makeSupabase = () => {
  const upsert  = jest.fn().mockResolvedValue({ error: null });
  const insert  = jest.fn().mockResolvedValue({ data: [{ id: 'conv-1' }], error: null });
  const selectSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const update  = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  const selectEq    = jest.fn().mockReturnValue({ single: selectSingle });
  const selectFrom  = jest.fn().mockReturnValue({ eq: selectEq });
  return {
    from: jest.fn().mockReturnValue({
      select: selectFrom,
      insert,
      upsert,
      update,
    }),
  } as unknown as SupabaseClient;
};

describe('WebhookService', () => {
  let service: WebhookService;
  let supa: SupabaseClient;

  beforeEach(() => {
    supa    = makeSupabase();
    service = new WebhookService(supa);
  });

  it('handleEvent ignores unknown event types without throwing', async () => {
    await expect(service.handleEvent('tok-1', { event: 'unknown.event', data: {} }))
      .resolves.not.toThrow();
  });

  it('handleConnectionUpdate updates user whatsapp_status', async () => {
    (supa.from as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null }),
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    });
    await service.handleEvent('tok-1', { event: 'connection.update', data: { state: 'open' } });
    // Verify update was called — from('users') should have been called
    expect(supa.from).toHaveBeenCalledWith('users');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test -- --testPathPattern="webhook.service"
```

Expected: `Cannot find module './webhook.service'`

- [ ] **Step 3: Implement WebhookService**

```typescript
// apps/api/src/modules/whatsapp/webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

interface EvolutionMessageEvent {
  event: string;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  async handleEvent(instanceToken: string, payload: EvolutionMessageEvent): Promise<void> {
    const { event, data } = payload;

    if (event === 'messages.upsert' || event === 'MESSAGE') {
      await this.handleMessage(instanceToken, data);
    } else if (event === 'connection.update') {
      await this.handleConnectionUpdate(instanceToken, data);
    } else {
      this.logger.debug(`Unhandled webhook event: ${event}`);
    }
  }

  private async handleMessage(token: string, data: Record<string, unknown>): Promise<void> {
    // Find owner by instance token
    const { data: userRow } = await this.supabase
      .from('users')
      .select('id')
      .eq('evolution_instance_token', token)
      .single();

    if (!userRow) {
      this.logger.warn(`Webhook: no user found for token ${token.slice(0, 8)}...`);
      return;
    }

    const key = data['key'] as Record<string, unknown> | undefined;
    const message = data['message'] as Record<string, unknown> | undefined;
    const remoteJid = (key?.['remoteJid'] ?? data['remoteJid'] ?? '') as string;
    const messageId = (key?.['id'] ?? data['id'] ?? '') as string;
    const fromMe = (key?.['fromMe'] ?? false) as boolean;
    const content = (
      (message?.['conversation'] as string | undefined) ??
      ((message?.['extendedTextMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined) ??
      ''
    );
    const direction: 'in' | 'out' = fromMe ? 'out' : 'in';

    if (!remoteJid || !messageId) return;

    // Normalize contact number: strip @s.whatsapp.net / @g.us
    const contactNumber = remoteJid.split('@')[0];

    // Find or create conversation
    const { data: existing } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('owner_user_id', userRow.id)
      .eq('contact_number', contactNumber)
      .single();

    let convId: string;

    if (existing) {
      convId = existing.id as string;
      await this.supabase
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', convId);
    } else {
      const { data: newConv } = await this.supabase
        .from('conversations')
        .insert({
          owner_user_id: userRow.id,
          contact_number: contactNumber,
          contact_name: contactNumber,
          status: 'nao_salva',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (!newConv) {
        this.logger.error('Failed to insert conversation');
        return;
      }
      convId = newConv.id as string;
    }

    // Insert message (ignore if duplicate evolution_message_id)
    await this.supabase.from('messages').upsert(
      {
        conversation_id: convId,
        direction,
        content: content || '[mídia]',
        message_type: 'text',
        evolution_message_id: messageId,
      },
      { onConflict: 'evolution_message_id', ignoreDuplicates: true },
    );
  }

  private async handleConnectionUpdate(token: string, data: Record<string, unknown>): Promise<void> {
    const state = (data['state'] ?? data['connection'] ?? '') as string;
    const statusMap: Record<string, string> = {
      open: 'connected',
      connecting: 'connecting',
      close: 'disconnected',
      closed: 'disconnected',
      conflict: 'disconnected',
    };
    const whatsappStatus = statusMap[state] ?? 'disconnected';

    const { data: userRow } = await this.supabase
      .from('users')
      .select('id, whatsapp_number')
      .eq('evolution_instance_token', token)
      .single();

    if (!userRow) return;

    const updates: Record<string, unknown> = { whatsapp_status: whatsappStatus };
    const phone = data['phoneNumber'] as string | undefined;
    if (phone) updates['whatsapp_number'] = phone;

    await this.supabase.from('users').update(updates).eq('id', userRow.id);
    this.logger.log(`Connection update for user ${userRow.id}: ${state} → ${whatsappStatus}`);
  }
}
```

- [ ] **Step 4: Implement WebhookController**

```typescript
// apps/api/src/modules/whatsapp/webhook.controller.ts
import { Controller, Post, Body, Query, Logger } from '@nestjs/common';
import { WebhookService } from './webhook.service';

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('whatsapp')
  async handleWhatsApp(
    @Query('token') token: string,
    @Body() payload: WebhookPayload,
  ): Promise<{ ok: boolean }> {
    if (!token) {
      this.logger.warn('Webhook called without token query param');
      return { ok: false };
    }

    try {
      await this.webhookService.handleEvent(token, {
        event: payload.event ?? '',
        data: (payload.data ?? payload) as Record<string, unknown>,
      });
    } catch (err) {
      this.logger.error('Webhook processing error', err);
    }

    return { ok: true };
  }
}
```

- [ ] **Step 5: Run webhook tests — expect PASS**

```bash
cd apps/api && pnpm test -- --testPathPattern="webhook.service"
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/
git commit -m "feat: WebhookService + WebhookController (message + connection.update events)"
```

---

## Task 5: ContextService + ConversationShareController

**Files:**
- Create: `apps/api/src/modules/whatsapp/context.service.ts`
- Create: `apps/api/src/modules/whatsapp/context.service.spec.ts`
- Create: `apps/api/src/modules/whatsapp/conversation-share.controller.ts`

- [ ] **Step 1: Write failing context service test**

```typescript
// apps/api/src/modules/whatsapp/context.service.spec.ts
import { ContextService } from './context.service';
import { SupabaseClient } from '@supabase/supabase-js';

const makeSupabase = (conv: object, messages: object[]) => {
  const singleConv = jest.fn().mockResolvedValue({ data: conv, error: null });
  const msgOrder   = jest.fn().mockResolvedValue({ data: messages, error: null });
  const upsert     = jest.fn().mockResolvedValue({ error: null });

  return {
    from: jest.fn().mockImplementation((table: string) => {
      if (table === 'conversations') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: singleConv }) }) };
      }
      if (table === 'messages') {
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: msgOrder }) }) };
      }
      if (table === 'context_files') {
        return { upsert };
      }
      return {};
    }),
    _upsert: upsert,
  } as unknown as SupabaseClient & { _upsert: jest.Mock };
};

describe('ContextService', () => {
  it('generateMd creates markdown with header and messages', async () => {
    const conv = {
      id: 'conv-1',
      contact_name: 'João',
      contact_number: '5547999',
      created_at: '2026-01-01T10:00:00Z',
      shared_at: '2026-01-01T11:00:00Z',
      owner_user_id: { name: 'Maria' },
    };
    const messages = [
      { direction: 'in', content: 'Olá!', sent_at: '2026-01-01T10:01:00Z' },
      { direction: 'out', content: 'Oi, como posso ajudar?', sent_at: '2026-01-01T10:02:00Z' },
    ];
    const supa = makeSupabase(conv, messages);
    const service = new ContextService(supa as unknown as SupabaseClient);
    await service.generateMd('conv-1');

    const upsertCall = (supa as unknown as { _upsert: jest.Mock })._upsert.mock.calls[0][0];
    expect(upsertCall.file_type).toBe('md');
    expect(upsertCall.content).toContain('João');
    expect(upsertCall.content).toContain('Olá!');
    expect(upsertCall.content).toContain('Oi, como posso ajudar?');
    expect(upsertCall.message_count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/api && pnpm test -- --testPathPattern="context.service"
```

Expected: `Cannot find module './context.service'`

- [ ] **Step 3: Implement ContextService**

```typescript
// apps/api/src/modules/whatsapp/context.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(private readonly supabase: SupabaseClient) {}

  async generateMd(conversationId: string): Promise<void> {
    // Fetch conversation (join owner name via foreign key embed)
    const { data: conv, error: convError } = await this.supabase
      .from('conversations')
      .select('*, owner_user_id(name)')
      .eq('id', conversationId)
      .single();

    if (convError || !conv) {
      this.logger.error(`generateMd: conversation ${conversationId} not found`);
      return;
    }

    // Fetch messages ordered by sent_at ascending
    const { data: messages } = await this.supabase
      .from('messages')
      .select('direction, content, sent_at, message_type')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true });

    const ownerName: string =
      (conv.owner_user_id as unknown as { name: string } | null)?.name ?? 'N/A';
    const sharedAt = conv.shared_at
      ? new Date(conv.shared_at as string).toLocaleString('pt-BR')
      : '—';
    const startedAt = new Date(conv.created_at as string).toLocaleString('pt-BR');

    const lines: string[] = [
      `# Conversa: ${conv.contact_name || conv.contact_number}`,
      '',
      `**Contato:** ${conv.contact_number}`,
      `**Atendente:** ${ownerName}`,
      `**Início:** ${startedAt}`,
      `**Compartilhado em:** ${sharedAt}`,
      '',
      '---',
      '',
      '## Mensagens',
      '',
    ];

    for (const msg of messages ?? []) {
      const dir = (msg.direction as string) === 'in' ? '📨 Contato' : '📤 Sistema';
      const ts  = new Date(msg.sent_at as string).toLocaleString('pt-BR');
      lines.push(`**${ts} [${dir}]:** ${msg.content || '[mídia]'}`);
      lines.push('');
    }

    const content = lines.join('\n');

    const { error } = await this.supabase.from('context_files').upsert(
      {
        conversation_id: conversationId,
        file_type: 'md',
        content,
        message_count: (messages ?? []).length,
        github_path: `conversations/${conversationId}.md`,
        status: 'pending',
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id,file_type' },
    );

    if (error) this.logger.error(`generateMd upsert failed: ${error.message}`);
    else this.logger.log(`MD generated for conversation ${conversationId}`);
  }
}
```

- [ ] **Step 4: Implement ConversationShareController**

```typescript
// apps/api/src/modules/whatsapp/conversation-share.controller.ts
import {
  Controller, Param, Post, UseGuards,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ContextService } from './context.service';

@Controller('conversations')
@UseGuards(AuthGuard)
export class ConversationShareController {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly context: ContextService,
  ) {}

  @Post(':id/share')
  async share(@Param('id') id: string, @CurrentUser() user: User) {
    // Verify conversation belongs to the caller
    const { data: conv, error } = await this.supabase
      .from('conversations')
      .select('id, owner_user_id, status')
      .eq('id', id)
      .single();

    if (error || !conv) throw new NotFoundException('Conversa não encontrada');
    if (conv.owner_user_id !== user.id) throw new ForbiddenException('Sem permissão');
    if (conv.status !== 'nao_salva') return { message: 'Conversa já compartilhada', status: conv.status };

    // Update status to pendente
    const { error: updateError } = await this.supabase
      .from('conversations')
      .update({
        status: 'pendente',
        shared_at: new Date().toISOString(),
        shared_by: user.id,
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // Generate .md async (non-blocking, errors are logged not thrown)
    this.context.generateMd(id).catch(() => {});

    return { message: 'Conversa compartilhada com a organização', status: 'pendente' };
  }
}
```

- [ ] **Step 5: Run context tests — expect PASS**

```bash
cd apps/api && pnpm test -- --testPathPattern="context.service"
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/whatsapp/
git commit -m "feat: ContextService (.md generation) + ConversationShareController"
```

---

## Task 6: WhatsAppModule + Register in AppModule

**Files:**
- Create: `apps/api/src/modules/whatsapp/whatsapp.module.ts`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Update configuration.ts**

Replace the full file:

```typescript
// apps/api/src/config/configuration.ts
export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:3001',
  supabase: {
    url: process.env.SUPABASE_URL ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },
  evolution: {
    url: process.env.EVOLUTION_URL ?? '',
    apiKey: process.env.EVOLUTION_API_KEY ?? '',
  },
});
```

- [ ] **Step 2: Create WhatsAppModule**

```typescript
// apps/api/src/modules/whatsapp/whatsapp.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { EvolutionService } from './evolution.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WebhookService } from './webhook.service';
import { WebhookController } from './webhook.controller';
import { ContextService } from './context.service';
import { ConversationShareController } from './conversation-share.controller';

@Module({
  imports: [AuthModule],
  providers: [
    EvolutionService,
    {
      provide: 'SUPABASE_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createClient(
          config.getOrThrow<string>('supabase.url'),
          config.getOrThrow<string>('supabase.serviceRoleKey'),
        ),
    },
    {
      provide: WebhookService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new WebhookService(supabase),
    },
    {
      provide: ContextService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new ContextService(supabase),
    },
    {
      provide: WhatsAppService,
      inject: [EvolutionService, 'SUPABASE_CLIENT', ConfigService],
      useFactory: (
        evo: EvolutionService,
        supabase: ReturnType<typeof createClient>,
        config: ConfigService,
      ) => new WhatsAppService(evo, supabase, config.get<string>('apiPublicUrl') ?? ''),
    },
    {
      provide: ConversationShareController,
      inject: ['SUPABASE_CLIENT', ContextService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        context: ContextService,
      ) => new ConversationShareController(supabase, context),
    },
  ],
  controllers: [WhatsAppController, WebhookController, ConversationShareController],
})
export class WhatsAppModule {}
```

- [ ] **Step 3: Register in AppModule**

```typescript
// apps/api/src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    UsersModule,
    WhatsAppModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 4: Run all tests — expect no regressions**

```bash
cd apps/api && pnpm test
```

Expected: all existing tests pass + new tests pass. No build errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/
git commit -m "feat: WhatsAppModule registered in AppModule, apiPublicUrl config added"
```

---

## Task 7: Rebuild /meu-numero Front-end

**Files:**
- Modify: `apps/web/src/app/(app)/meu-numero/page.tsx`

This page replaces the current placeholder with a fully functional two-tab UI.

**Tab "Conexão":** Shows current connection status. If not connected, shows a "Conectar" button. Once connecting, shows a QR code (polling every 3 s) and a pairing code option. When connected, shows a green status.

**Tab "Conversas":** Lists conversations with `status = 'nao_salva'` or `'pendente'` owned by the current user. Each row has a "Compartilhar" button (disabled if already pendente/shared).

The page calls the NestJS API with a Bearer token from the Supabase session.

- [ ] **Step 1: Write the new page**

```tsx
// apps/web/src/app/(app)/meu-numero/page.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AppUser, Conversation } from '@crmwhats/types';
import Image from 'next/image';

// ── helpers ──────────────────────────────────────────────────────────────────

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(txt);
  }
  return res.json();
}

// ── styles ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)',
  borderRadius: 'var(--radius)', padding: '24px', marginBottom: 16,
};

const btn = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  background: variant === 'primary' ? 'var(--ammoc-green)' : variant === 'danger' ? 'var(--ammoc-red)' : 'var(--ammoc-paper-2)',
  color: variant === 'ghost' ? 'var(--ammoc-ink-600)' : 'white',
  border: variant === 'ghost' ? '1px solid var(--ammoc-line-2)' : 'none',
  borderRadius: 'var(--radius-sm)', padding: '8px 18px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
});

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px', fontSize: 13, fontWeight: active ? 700 : 500,
  color: active ? 'var(--ammoc-green-700)' : 'var(--ammoc-ink-400)',
  borderBottom: active ? '2px solid var(--ammoc-green)' : '2px solid transparent',
  background: 'none', border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-body)',
});

// ── main component ────────────────────────────────────────────────────────────

export default function MeuNumeroPage() {
  const supabase = createClient();
  const [user, setUser] = useState<AppUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<'conexao' | 'conversas'>('conexao');
  const [loading, setLoading] = useState(true);

  // Connection tab state
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairPhone, setPairPhone] = useState('');
  const [showPair, setShowPair] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Conversations tab state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [convError, setConvError] = useState<string | null>(null);

  // ── Load user + session ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token ?? null;
      setToken(accessToken);

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData.user?.id;
      if (!uid) { setLoading(false); return; }

      const { data } = await supabase.from('users').select('*').eq('id', uid).single();
      if (data) {
        setUser(data as AppUser);
        setWsStatus((data as AppUser).whatsapp_status ?? 'disconnected');
      }
      setLoading(false);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── QR polling ────────────────────────────────────────────────────────────────
  const startQrPoll = useCallback((tok: string) => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = setInterval(async () => {
      try {
        const data = await apiFetch('/api/whatsapp/qr', tok);
        if (data.base64) setQrBase64(data.base64);
      } catch {
        // QR not ready yet — keep polling
      }

      // Check status
      try {
        const st = await apiFetch('/api/whatsapp/status', tok);
        if (st.status === 'connected' || st.status === 'open') {
          setWsStatus('connected');
          setQrBase64(null);
          if (qrPollRef.current) clearInterval(qrPollRef.current);
        }
      } catch { /* ignore */ }
    }, 3000);
  }, []);

  useEffect(() => () => { if (qrPollRef.current) clearInterval(qrPollRef.current); }, []);

  // ── Actions ───────────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (!token) return;
    setActionLoading(true);
    setConnError(null);
    setQrBase64(null);
    try {
      await apiFetch('/api/whatsapp/connect', token, { method: 'POST', body: '{}' });
      setWsStatus('connecting');
      startQrPoll(token);
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao conectar');
    }
    setActionLoading(false);
  }

  async function handleDisconnect() {
    if (!token) return;
    setActionLoading(true);
    setConnError(null);
    try {
      await apiFetch('/api/whatsapp/disconnect', token, { method: 'DELETE' });
      setWsStatus('disconnected');
      setQrBase64(null);
      setPairCode(null);
      if (qrPollRef.current) clearInterval(qrPollRef.current);
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao desconectar');
    }
    setActionLoading(false);
  }

  async function handlePair() {
    if (!token || !pairPhone.trim()) return;
    setActionLoading(true);
    setConnError(null);
    try {
      const phone = pairPhone.replace(/\D/g, '');
      const data = await apiFetch('/api/whatsapp/pair', token, {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setPairCode(data.code ?? 'Código não disponível');
    } catch (e: unknown) {
      setConnError(e instanceof Error ? e.message : 'Erro ao obter código');
    }
    setActionLoading(false);
  }

  // ── Load conversations ────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'conversas' || !user) return;
    async function load() {
      setConvError(null);
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('owner_user_id', user!.id)
        .in('status', ['nao_salva', 'pendente'])
        .order('last_message_at', { ascending: false });
      if (error) setConvError(error.message);
      else setConversations((data ?? []) as Conversation[]);
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user]);

  async function handleShare(convId: string) {
    if (!token) return;
    setSharingId(convId);
    setConvError(null);
    try {
      await apiFetch(`/api/conversations/${convId}/share`, token, { method: 'POST', body: '{}' });
      setConversations(prev => prev.map(c => c.id === convId ? { ...c, status: 'pendente' as const } : c));
    } catch (e: unknown) {
      setConvError(e instanceof Error ? e.message : 'Erro ao compartilhar');
    }
    setSharingId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 32, color: 'var(--ammoc-ink-400)', fontSize: 14 }}>Carregando...</div>;

  const statusColor = wsStatus === 'connected'
    ? 'var(--ammoc-green)' : wsStatus === 'connecting'
    ? '#F59E0B' : 'var(--ammoc-ink-400)';
  const statusLabel = wsStatus === 'connected' ? 'Conectado' : wsStatus === 'connecting' ? 'Conectando…' : 'Desconectado';

  return (
    <div style={{ padding: '32px', flex: 1, maxWidth: 700 }}>
      {/* Header */}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
        Meu Número WhatsApp
      </h1>
      <p style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, margin: '0 0 20px' }}>
        Conecte seu número e gerencie conversas.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--ammoc-line)', marginBottom: 20 }}>
        <button style={tabBtn(tab === 'conexao')} onClick={() => setTab('conexao')}>Conexão</button>
        <button style={tabBtn(tab === 'conversas')} onClick={() => setTab('conversas')}>Minhas Conversas</button>
      </div>

      {/* ── TAB: CONEXÃO ──────────────────────────────────────────────────────── */}
      {tab === 'conexao' && (
        <>
          {/* Status card */}
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)' }}>{statusLabel}</div>
                  {user?.whatsapp_number && (
                    <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>{user.whatsapp_number}</div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {wsStatus === 'disconnected' && (
                  <button style={btn('primary')} onClick={handleConnect} disabled={actionLoading}>
                    {actionLoading ? 'Conectando…' : 'Conectar WhatsApp'}
                  </button>
                )}
                {wsStatus !== 'disconnected' && (
                  <button style={btn('danger')} onClick={handleDisconnect} disabled={actionLoading}>
                    Desconectar
                  </button>
                )}
              </div>
            </div>
          </div>

          {connError && (
            <div style={{ background: 'var(--ammoc-red-100)', border: '1px solid var(--ammoc-red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--ammoc-red-700)', marginBottom: 16 }}>
              {connError}
            </div>
          )}

          {/* QR Code */}
          {wsStatus === 'connecting' && (
            <div style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 8 }}>
                Escaneie o QR code
              </div>
              <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', marginBottom: 16 }}>
                Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho
              </p>
              {qrBase64 ? (
                <Image
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  width={220}
                  height={220}
                  style={{ margin: '0 auto', display: 'block', borderRadius: 8 }}
                  unoptimized
                />
              ) : (
                <div style={{ width: 220, height: 220, background: 'var(--ammoc-surface)', borderRadius: 8, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ammoc-ink-400)', fontSize: 13 }}>
                  Aguardando QR…
                </div>
              )}

              {/* Pairing code alternative */}
              <div style={{ marginTop: 20 }}>
                <button style={{ ...btn('ghost'), fontSize: 12 }} onClick={() => setShowPair(p => !p)}>
                  {showPair ? 'Ocultar' : 'Usar código de pareamento'}
                </button>
              </div>

              {showPair && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="tel"
                    placeholder="55479999999999"
                    value={pairPhone}
                    onChange={e => setPairPhone(e.target.value)}
                    style={{ border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font-body)', background: 'var(--ammoc-paper)', color: 'var(--ammoc-ink)', outline: 'none', width: 200 }}
                  />
                  <button style={btn('primary')} onClick={handlePair} disabled={actionLoading || !pairPhone.trim()}>
                    Obter código
                  </button>
                </div>
              )}

              {pairCode && (
                <div style={{ marginTop: 12, background: 'var(--ammoc-green-100)', border: '1px solid var(--ammoc-green)', borderRadius: 'var(--radius-sm)', padding: '12px 20px', display: 'inline-block' }}>
                  <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginBottom: 4 }}>Código de pareamento</div>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.2em', color: 'var(--ammoc-green-800)', fontFamily: 'var(--font-mono)' }}>{pairCode}</div>
                  <div style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', marginTop: 4 }}>Digite este código no WhatsApp → Aparelhos conectados</div>
                </div>
              )}
            </div>
          )}

          {wsStatus === 'connected' && (
            <div style={{ ...card, background: 'var(--ammoc-green-100)', border: '1px solid var(--ammoc-green)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ammoc-green-800)' }}>
                ✅ WhatsApp conectado com sucesso!
              </div>
              <p style={{ fontSize: 13, color: 'var(--ammoc-green-700)', margin: '6px 0 0' }}>
                As mensagens recebidas aparecerão na aba &quot;Minhas Conversas&quot;.
              </p>
            </div>
          )}
        </>
      )}

      {/* ── TAB: CONVERSAS ────────────────────────────────────────────────────── */}
      {tab === 'conversas' && (
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ammoc-ink-900)', marginBottom: 4 }}>
            Conversas recebidas no seu WhatsApp
          </div>
          <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', margin: '0 0 16px' }}>
            Selecione as conversas que deseja compartilhar com a organização.
          </p>

          {convError && (
            <div style={{ background: 'var(--ammoc-red-100)', border: '1px solid var(--ammoc-red)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--ammoc-red-700)', marginBottom: 16 }}>
              {convError}
            </div>
          )}

          {conversations.length === 0 ? (
            <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              Nenhuma conversa ainda. Conecte seu WhatsApp e aguarde mensagens.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {conversations.map(conv => (
                <div
                  key={conv.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--ammoc-line)' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ammoc-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.contact_name || conv.contact_number}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ammoc-ink-400)' }}>
                      {conv.contact_number}
                      {conv.last_message_at && ` · ${new Date(conv.last_message_at).toLocaleDateString('pt-BR')}`}
                    </div>
                  </div>
                  {conv.status === 'nao_salva' ? (
                    <button
                      style={btn('primary')}
                      onClick={() => handleShare(conv.id)}
                      disabled={sharingId === conv.id}
                    >
                      {sharingId === conv.id ? 'Compartilhando…' : 'Compartilhar'}
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)' }}>
                      Compartilhada
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify page compiles**

```bash
cd apps/web && pnpm build 2>&1 | tail -20
```

Expected: build succeeds (or only pre-existing warnings). No TypeScript errors for the new page.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/meu-numero/page.tsx
git commit -m "feat: rebuild /meu-numero — Connection tab (QR + pairing) + Conversas tab"
```

---

## Task 8: Add API_PUBLIC_URL to apps/api/.env

- [ ] **Step 1: Check that apps/api/.env has the new variable**

Read `apps/api/.env` and verify (or add) these two lines:

```
EVOLUTION_URL=http://2.25.139.166:8085
EVOLUTION_API_KEY=EvolutionGo@2025Secure
API_PUBLIC_URL=https://api.crmwhats.ammoc.org.br
```

`API_PUBLIC_URL` is what Evolution Go uses to call back via webhook. It must be the publicly reachable URL of the NestJS API on Coolify.

- [ ] **Step 2: Check NEXT_PUBLIC_API_URL in apps/web/.env.local**

Read `apps/web/.env.local` and verify (or add):

```
NEXT_PUBLIC_API_URL=https://api.crmwhats.ammoc.org.br
```

- [ ] **Step 3: Trigger Coolify redeployment**

After env var additions are saved, trigger deploy for both `api` and `web` services in Coolify so the containers pick up the new values.

---

## Self-Review Checklist

- [x] **Spec §3 DB columns:** migration adds `whatsapp_status`, `shared_at`, `shared_by`, `content`, unique constraint ✓
- [x] **Spec §4 EvolutionService:** all 6 methods implemented ✓
- [x] **Spec §4 WhatsAppController:** all 5 endpoints ✓
- [x] **Spec §4 WebhookController:** receives events, identifies user by token query param ✓
- [x] **Spec §5 Sharing flow:** `POST /api/conversations/:id/share` → status pendente + MD generation ✓
- [x] **Spec §5 ContextService:** markdown with header + messages, upsert to context_files ✓
- [x] **Spec §6 /meu-numero:** Connection tab (QR + pairing) + Conversas tab ✓
- [x] **Spec §7 Env vars:** `API_PUBLIC_URL` added to configuration.ts and checked in Task 8 ✓
- [x] **Type consistency:** `SupabaseClient` injected via factory in module (matches UsersModule pattern) ✓
- [x] **No placeholders:** every step has real code ✓
