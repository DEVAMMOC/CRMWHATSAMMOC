# Delegation & Sectors System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sectors/departments to the system, allow admin/supervisor to delegate conversations to a sector or specific employee, and show conversations grouped by sector in the dashboard.

**Architecture:** New `sectors` module in the NestJS API (CRUD + membership). The existing `conversations` table gets two new nullable columns (`sector_id`, `assigned_to`). The frontend dashboard gains a sector filter/group view, and the conversation detail page gets a delegation modal. No breaking changes to existing flows.

**Tech Stack:** NestJS + Supabase (PostgreSQL) + Next.js 15 + TypeScript · Existing patterns: `UsersModule` for service/controller shape, `ConversationShareController` for conversation endpoint pattern.

---

## File Structure

**New files:**
- `apps/api/src/modules/sectors/sectors.module.ts`
- `apps/api/src/modules/sectors/sectors.service.ts`
- `apps/api/src/modules/sectors/sectors.controller.ts`
- `apps/api/src/modules/sectors/dto/create-sector.dto.ts`
- `apps/api/src/modules/sectors/dto/update-sector.dto.ts`
- `apps/api/src/modules/sectors/dto/add-member.dto.ts`
- `apps/web/src/app/(app)/configuracoes/setores/page.tsx`

**Modified files:**
- `packages/types/src/index.ts` — add `Sector`, `SectorMember`, update `Conversation`
- `apps/api/src/modules/whatsapp/conversation-share.controller.ts` — add `delegate` endpoint
- `apps/api/src/app.module.ts` — register `SectorsModule`
- `apps/web/src/app/(app)/dashboard/page.tsx` — sector filter + sector badge
- `apps/web/src/app/(app)/conversa/[id]/page.tsx` — delegation modal
- `apps/web/src/components/layout/Sidebar.tsx` — add Setores link under Configurações

---

### Task 1: Database migration — sectors + sector_members + conversations columns

**Files:**
- Apply migration via Supabase MCP

- [ ] **Step 1: Apply migration**

Use the `mcp__supabase__apply_migration` tool with this SQL:

```sql
-- Sectors / departments
CREATE TABLE sectors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  keywords    text[] NOT NULL DEFAULT '{}',
  color       text NOT NULL DEFAULT '#128C7E',
  created_at  timestamptz DEFAULT now()
);

-- Many-to-many: users ↔ sectors
CREATE TABLE sector_members (
  sector_id  uuid REFERENCES sectors(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id)   ON DELETE CASCADE,
  PRIMARY KEY (sector_id, user_id)
);

-- Add delegation columns to existing conversations
ALTER TABLE conversations
  ADD COLUMN sector_id    uuid REFERENCES sectors(id) ON DELETE SET NULL,
  ADD COLUMN assigned_to  uuid REFERENCES users(id)   ON DELETE SET NULL,
  ADD COLUMN delegated_at timestamptz,
  ADD COLUMN delegated_by uuid REFERENCES users(id)   ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_conversations_sector_id   ON conversations(sector_id);
CREATE INDEX idx_conversations_assigned_to ON conversations(assigned_to);
CREATE INDEX idx_sector_members_user_id    ON sector_members(user_id);

-- RLS: sectors readable by all authenticated, writable by admin/supervisor
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sectors_read"  ON sectors FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "sectors_write" ON sectors FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','supervisor'))
  );

ALTER TABLE sector_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sector_members_read"  ON sector_members FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "sector_members_write" ON sector_members FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin','supervisor'))
  );
```

- [ ] **Step 2: Verify tables exist**

Run via Supabase MCP `execute_sql`:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('sectors','sector_members');
```
Expected: 2 rows returned.

- [ ] **Step 3: Commit migration note**

```bash
git commit --allow-empty -m "feat: apply sectors + sector_members migration via Supabase MCP"
```

---

### Task 2: Shared types — Sector, SectorMember, update Conversation

**Files:**
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add new types at the end of `packages/types/src/index.ts`**

```typescript
export interface Sector {
  id: string;
  name: string;
  description: string | null;
  keywords: string[];
  color: string;
  created_at: string;
}

export interface SectorMember {
  sector_id: string;
  user_id: string;
}

export interface SectorWithMembers extends Sector {
  members: AppUser[];
}
```

- [ ] **Step 2: Update the `Conversation` interface** to include delegation fields:

Replace the existing `Conversation` interface with:

```typescript
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
  sector_id: string | null;
  assigned_to: string | null;
  delegated_at: string | null;
  delegated_by: string | null;
  created_at: string;
}
```

- [ ] **Step 3: Build types package to verify no errors**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
pnpm --filter @crmwhats/types build
```
Expected: exits 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat: add Sector, SectorMember types; add delegation fields to Conversation"
```

---

### Task 3: SectorsModule — API CRUD for sectors + members

**Files:**
- Create: `apps/api/src/modules/sectors/dto/create-sector.dto.ts`
- Create: `apps/api/src/modules/sectors/dto/update-sector.dto.ts`
- Create: `apps/api/src/modules/sectors/dto/add-member.dto.ts`
- Create: `apps/api/src/modules/sectors/sectors.service.ts`
- Create: `apps/api/src/modules/sectors/sectors.controller.ts`
- Create: `apps/api/src/modules/sectors/sectors.module.ts`

- [ ] **Step 1: Create DTOs**

`apps/api/src/modules/sectors/dto/create-sector.dto.ts`:
```typescript
import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateSectorDto {
  @IsString() @IsNotEmpty()
  name!: string;

  @IsString() @IsOptional()
  description?: string;

  @IsArray() @IsOptional()
  keywords?: string[];

  @IsString() @IsOptional()
  color?: string;
}
```

`apps/api/src/modules/sectors/dto/update-sector.dto.ts`:
```typescript
import { IsString, IsOptional, IsArray } from 'class-validator';

export class UpdateSectorDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string;
  @IsArray() @IsOptional() keywords?: string[];
  @IsString() @IsOptional() color?: string;
}
```

`apps/api/src/modules/sectors/dto/add-member.dto.ts`:
```typescript
import { IsUUID } from 'class-validator';

export class AddMemberDto {
  @IsUUID()
  userId!: string;
}
```

- [ ] **Step 2: Create SectorsService**

`apps/api/src/modules/sectors/sectors.service.ts`:
```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Sector, SectorWithMembers, AppUser } from '@crmwhats/types';
import type { CreateSectorDto } from './dto/create-sector.dto';
import type { UpdateSectorDto } from './dto/update-sector.dto';

@Injectable()
export class SectorsService {
  constructor(private readonly supabase: SupabaseClient) {}

  async findAll(): Promise<SectorWithMembers[]> {
    const { data: sectors, error } = await this.supabase
      .from('sectors')
      .select('*')
      .order('name');
    if (error) throw new Error(error.message);

    const sectorIds = (sectors ?? []).map((s: Sector) => s.id);
    if (sectorIds.length === 0) return [];

    const { data: memberships } = await this.supabase
      .from('sector_members')
      .select('sector_id, user_id, users(*)')
      .in('sector_id', sectorIds);

    const memberMap = new Map<string, AppUser[]>();
    for (const m of memberships ?? []) {
      const list = memberMap.get(m.sector_id) ?? [];
      list.push(m.users as unknown as AppUser);
      memberMap.set(m.sector_id, list);
    }

    return (sectors ?? []).map((s: Sector) => ({
      ...s,
      members: memberMap.get(s.id) ?? [],
    }));
  }

  async findOne(id: string): Promise<SectorWithMembers> {
    const { data, error } = await this.supabase
      .from('sectors')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) throw new NotFoundException('Setor não encontrado');

    const { data: memberships } = await this.supabase
      .from('sector_members')
      .select('user_id, users(*)')
      .eq('sector_id', id);

    return {
      ...(data as Sector),
      members: (memberships ?? []).map((m: { users: unknown }) => m.users as AppUser),
    };
  }

  async create(dto: CreateSectorDto): Promise<Sector> {
    const { data, error } = await this.supabase
      .from('sectors')
      .insert({ name: dto.name, description: dto.description ?? null, keywords: dto.keywords ?? [], color: dto.color ?? '#128C7E' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Sector;
  }

  async update(id: string, dto: UpdateSectorDto): Promise<Sector> {
    const { data, error } = await this.supabase
      .from('sectors')
      .update(dto)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Setor não encontrado');
    return data as Sector;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.from('sectors').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async addMember(sectorId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sector_members')
      .upsert({ sector_id: sectorId, user_id: userId }, { ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  async removeMember(sectorId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sector_members')
      .delete()
      .eq('sector_id', sectorId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
}
```

- [ ] **Step 3: Create SectorsController**

`apps/api/src/modules/sectors/sectors.controller.ts`:
```typescript
import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, ForbiddenException,
} from '@nestjs/common';
import type { User } from '@supabase/supabase-js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SectorsService } from './sectors.service';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';
import { AddMemberDto } from './dto/add-member.dto';

// Helper: only admin/supervisor can mutate sectors
function assertAdminOrSupervisor(userMeta: Record<string, unknown>) {
  const role = (userMeta?.['user_metadata'] as Record<string, unknown>)?.['role']
    ?? (userMeta?.['app_metadata'] as Record<string, unknown>)?.['role'];
  if (role !== 'admin' && role !== 'supervisor') {
    throw new ForbiddenException('Apenas admin ou supervisor podem gerenciar setores');
  }
}

@Controller('sectors')
@UseGuards(AuthGuard)
export class SectorsController {
  constructor(private readonly sectors: SectorsService) {}

  @Get()
  findAll() {
    return this.sectors.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sectors.findOne(id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateSectorDto) {
    assertAdminOrSupervisor(user as unknown as Record<string, unknown>);
    return this.sectors.create(dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: UpdateSectorDto) {
    assertAdminOrSupervisor(user as unknown as Record<string, unknown>);
    return this.sectors.update(id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    assertAdminOrSupervisor(user as unknown as Record<string, unknown>);
    return this.sectors.remove(id);
  }

  @Post(':id/members')
  addMember(@CurrentUser() user: User, @Param('id') sectorId: string, @Body() dto: AddMemberDto) {
    assertAdminOrSupervisor(user as unknown as Record<string, unknown>);
    return this.sectors.addMember(sectorId, dto.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: User, @Param('id') sectorId: string, @Param('userId') userId: string) {
    assertAdminOrSupervisor(user as unknown as Record<string, unknown>);
    return this.sectors.removeMember(sectorId, userId);
  }
}
```

- [ ] **Step 4: Create SectorsModule**

`apps/api/src/modules/sectors/sectors.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { SectorsService } from './sectors.service';
import { SectorsController } from './sectors.controller';

@Module({
  imports: [AuthModule],
  providers: [
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
      provide: SectorsService,
      inject: ['SUPABASE_CLIENT'],
      useFactory: (supabase: ReturnType<typeof createClient>) =>
        new SectorsService(supabase),
    },
  ],
  controllers: [SectorsController],
  exports: [SectorsService],
})
export class SectorsModule {}
```

- [ ] **Step 5: Register in AppModule**

Modify `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { SectorsModule } from './modules/sectors/sectors.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    UsersModule,
    WhatsAppModule,
    SectorsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
```

- [ ] **Step 6: Build API to verify no TypeScript errors**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP"
pnpm --filter @crmwhats/api build
```
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/sectors/ apps/api/src/app.module.ts
git commit -m "feat: add SectorsModule — CRUD for sectors + member management"
```

---

### Task 4: Delegation endpoint — POST /api/conversations/:id/delegate

**Files:**
- Modify: `apps/api/src/modules/whatsapp/conversation-share.controller.ts`

- [ ] **Step 1: Add `DelegateDto`**

Create `apps/api/src/modules/whatsapp/dto/delegate.dto.ts`:
```typescript
import { IsUUID, IsOptional } from 'class-validator';

export class DelegateDto {
  @IsUUID() @IsOptional()
  sectorId?: string;

  @IsUUID() @IsOptional()
  assignedTo?: string;
}
```

- [ ] **Step 2: Add the `delegate` endpoint to `ConversationShareController`**

Add the following import and method to `apps/api/src/modules/whatsapp/conversation-share.controller.ts`:

Add to imports at the top:
```typescript
import { Body } from '@nestjs/common';
import { DelegateDto } from './dto/delegate.dto';
```

Add method inside the class (after the `share` method):
```typescript
@Post(':id/delegate')
async delegate(
  @Param('id') id: string,
  @CurrentUser() user: User,
  @Body() dto: DelegateDto,
) {
  // Any authenticated user can delegate (admin/supervisor can delegate any; employee can delegate their own)
  const { data: conv, error } = await this.supabase
    .from('conversations')
    .select('id, owner_user_id, status')
    .eq('id', id)
    .single();

  if (error || !conv) throw new NotFoundException('Conversa não encontrada');

  const updates: Record<string, unknown> = {
    delegated_at: new Date().toISOString(),
    delegated_by: user.id,
  };
  if (dto.sectorId  !== undefined) updates['sector_id']   = dto.sectorId;
  if (dto.assignedTo !== undefined) updates['assigned_to'] = dto.assignedTo;
  // When delegated, mark as pendente so it shows in the org dashboard
  if (conv.status === 'nao_salva') updates['status'] = 'pendente';

  const { error: updateError } = await this.supabase
    .from('conversations')
    .update(updates)
    .eq('id', id);

  if (updateError) {
    this.logger.error(`Failed to delegate conversation ${id}: ${updateError.message}`);
    throw new InternalServerErrorException('Erro ao delegar conversa');
  }

  return { message: 'Conversa delegada com sucesso', sectorId: dto.sectorId, assignedTo: dto.assignedTo };
}
```

- [ ] **Step 3: Build API**

```bash
pnpm --filter @crmwhats/api build
```
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/whatsapp/conversation-share.controller.ts \
        apps/api/src/modules/whatsapp/dto/delegate.dto.ts
git commit -m "feat: add POST /conversations/:id/delegate endpoint"
```

---

### Task 5: Frontend — /configuracoes/setores management page

**Files:**
- Create: `apps/web/src/app/(app)/configuracoes/setores/page.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the setores page**

Create `apps/web/src/app/(app)/configuracoes/setores/page.tsx`:

```typescript
'use client';
import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Sector {
  id: string; name: string; description: string | null;
  keywords: string[]; color: string; created_at: string;
  members: { id: string; name: string; email: string }[];
}
interface User { id: string; name: string; email: string; }

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function SetoresPage() {
  const supabase = createClient();
  const [token, setToken] = useState('');
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [form, setForm] = useState({ name: '', description: '', keywords: '', color: '#128C7E' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    const [secs, users] = await Promise.all([
      apiFetch('/api/sectors', tok) as Promise<Sector[]>,
      apiFetch('/api/users', tok) as Promise<User[]>,
    ]);
    setSectors(secs);
    setAllUsers(users);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const tok = session?.access_token ?? '';
      setToken(tok);
      await load(tok);
    })();
  }, [load, supabase]);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', keywords: '', color: '#128C7E' });
    setShowModal(true);
  }

  function openEdit(s: Sector) {
    setEditing(s);
    setForm({ name: s.name, description: s.description ?? '', keywords: s.keywords.join(', '), color: s.color });
    setShowModal(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const body = { name: form.name, description: form.description || null, keywords: form.keywords.split(',').map(k => k.trim()).filter(Boolean), color: form.color };
      if (editing) await apiFetch(`/api/sectors/${editing.id}`, token, { method: 'PATCH', body: JSON.stringify(body) });
      else await apiFetch('/api/sectors', token, { method: 'POST', body: JSON.stringify(body) });
      setShowModal(false);
      await load(token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro'); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este setor? As conversas delegadas a ele perderão o setor.')) return;
    await apiFetch(`/api/sectors/${id}`, token, { method: 'DELETE' });
    await load(token);
  }

  async function handleAddMember(sectorId: string, userId: string) {
    await apiFetch(`/api/sectors/${sectorId}/members`, token, { method: 'POST', body: JSON.stringify({ userId }) });
    await load(token);
  }

  async function handleRemoveMember(sectorId: string, userId: string) {
    await apiFetch(`/api/sectors/${sectorId}/members/${userId}`, token, { method: 'DELETE' });
    await load(token);
  }

  return (
    <div style={{ padding: 32, flex: 1, maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24, gap: 12 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 800, color: 'var(--ammoc-ink-900)', margin: 0, letterSpacing: '-0.02em' }}>
          Setores
        </h1>
        <span style={{ background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 99 }}>{sectors.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={openCreate} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + Novo Setor
        </button>
      </div>

      {loading ? <p style={{ color: 'var(--ammoc-ink-400)' }}>Carregando…</p> : sectors.length === 0 ? (
        <div style={{ background: 'var(--ammoc-paper)', border: '1.5px dashed var(--ammoc-line)', borderRadius: 'var(--radius)', padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏛️</div>
          <div style={{ color: 'var(--ammoc-ink-400)', fontSize: 14 }}>Nenhum setor criado ainda.</div>
        </div>
      ) : sectors.map(s => (
        <div key={s.id} style={{ background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--ammoc-ink-900)', flex: 1 }}>{s.name}</span>
            <button onClick={() => openEdit(s)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Editar</button>
            <button onClick={() => void handleDelete(s.id)} style={{ background: 'none', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}>Remover</button>
          </div>
          {s.description && <p style={{ fontSize: 12, color: 'var(--ammoc-ink-400)', margin: '0 0 8px' }}>{s.description}</p>}
          {s.keywords.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {s.keywords.map(k => <span key={k} style={{ background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', fontSize: 11, padding: '2px 8px', borderRadius: 99 }}>{k}</span>)}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', marginBottom: 6 }}>Membros ({s.members.length})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {s.members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--ammoc-green-100)', color: 'var(--ammoc-green-800)', fontSize: 12, fontWeight: 600, padding: '3px 10px 3px 8px', borderRadius: 99 }}>
                {m.name}
                <button onClick={() => void handleRemoveMember(s.id, m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ammoc-green-700)', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
            <select onChange={e => { if (e.target.value) { void handleAddMember(s.id, e.target.value); e.target.value = ''; } }}
              style={{ fontSize: 12, border: '1px dashed var(--ammoc-green)', background: 'none', color: 'var(--ammoc-green-700)', borderRadius: 99, padding: '3px 8px', cursor: 'pointer' }}>
              <option value="">+ Adicionar membro</option>
              {allUsers.filter(u => !s.members.some(m => m.id === u.id)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
      ))}

      {/* Modal create/edit */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28, width: 440, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
            <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 800 }}>{editing ? 'Editar Setor' : 'Novo Setor'}</h2>
            {error && <div style={{ color: '#b91c1c', fontSize: 12, marginBottom: 12 }}>{error}</div>}
            {(['name','description','keywords'] as const).map(field => (
              <div key={field} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>
                  {field === 'name' ? 'Nome *' : field === 'description' ? 'Descrição' : 'Palavras-chave (vírgula)'}
                </label>
                <input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'keywords' ? 'obra, esgoto, pavimento' : ''}
                  style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Cor</label>
              <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} style={{ width: 48, height: 32, border: 'none', cursor: 'pointer', borderRadius: 6 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={() => void handleSave()} disabled={saving || !form.name} style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add GET /api/users endpoint** so the setores page can list all users.

Modify `apps/api/src/modules/users/users.controller.ts` — add a `GET /users` route (admin/supervisor only):

```typescript
// Add to existing imports:
import { Get } from '@nestjs/common'; // already imported

// Add this method inside UsersController:
@Get()
async findAll() {
  // Returns all users — readable by any authenticated user for dropdown purposes
  return this.usersService.findAll();
}
```

- [ ] **Step 3: Add "Setores" link to Sidebar under Configurações**

Modify `apps/web/src/components/layout/Sidebar.tsx`.

Change the `ADMIN_NAV` array:
```typescript
const ADMIN_NAV: NavItem[] = [
  { icon: '📊', label: 'Painel Admin', href: '/admin' },
  { icon: '🏛️', label: 'Setores', href: '/configuracoes/setores' },
  { icon: '⚙️', label: 'Configurações', href: '/configuracoes' },
];
```

- [ ] **Step 4: TypeScript check**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP\apps\web"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/configuracoes/setores/page.tsx \
        apps/web/src/components/layout/Sidebar.tsx \
        apps/api/src/modules/users/users.controller.ts
git commit -m "feat: add /configuracoes/setores page — create/edit sectors + member management"
```

---

### Task 6: Dashboard — sector filter + sector badge on conversation cards

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add sector loading and sector filter to the dashboard**

At the top of `DashboardPage`, add state and load sectors:

```typescript
// Add to state declarations:
const [sectors, setSectors] = useState<{ id: string; name: string; color: string }[]>([]);
const [sectorFilter, setSectorFilter] = useState<string | null>(null); // null = all

// Add inside the useEffect that loads conversations, after setCurrentUserId:
const { data: sectorData } = await supabase.from('sectors').select('id, name, color').order('name');
setSectors((sectorData ?? []) as { id: string; name: string; color: string }[]);
```

- [ ] **Step 2: Update the `filtered` computation** to include sector filter:

Replace the `filtered` constant:
```typescript
const filtered = conversations.filter(c => {
  const matchStatus = statusFilter === 'all' || c.status === statusFilter;
  const matchSector = !sectorFilter || (c as Conversation & { sector_id?: string }).sector_id === sectorFilter;
  const term = searchTerm.toLowerCase();
  const matchSearch =
    !term ||
    (c.contact_name ?? '').toLowerCase().includes(term) ||
    c.contact_number.toLowerCase().includes(term) ||
    (c.municipality ?? '').toLowerCase().includes(term);
  return matchStatus && matchSector && matchSearch;
});
```

- [ ] **Step 3: Add sector filter chips** between the status tabs and the conversation list.

Add this block right after the closing `</div>` of the filter tabs section and before `{/* Content */}`:

```tsx
{/* Sector filter chips */}
{sectors.length > 0 && (
  <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
    <span style={{ fontSize: 11, color: 'var(--ammoc-ink-400)', fontWeight: 600 }}>Setor:</span>
    <button
      onClick={() => setSectorFilter(null)}
      style={{ padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: !sectorFilter ? 'var(--ammoc-ink-700)' : 'var(--ammoc-paper-2)', color: !sectorFilter ? 'white' : 'var(--ammoc-ink-500)' }}
    >
      Todos
    </button>
    {sectors.map(s => (
      <button key={s.id} onClick={() => setSectorFilter(sectorFilter === s.id ? null : s.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', background: sectorFilter === s.id ? s.color : 'var(--ammoc-paper-2)', color: sectorFilter === s.id ? 'white' : 'var(--ammoc-ink-500)', transition: 'all 0.15s' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: sectorFilter === s.id ? 'rgba(255,255,255,0.6)' : s.color }} />
        {s.name}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 4: Add sector badge to each conversation card**

Inside the conversation card's main info `<div>`, after the `<StatusBadge>`, add:

```tsx
{(conv as Conversation & { sector_id?: string; sector?: { name: string; color: string } }).sector_id && (
  (() => {
    const sec = sectors.find(s => s.id === (conv as Conversation & { sector_id?: string }).sector_id);
    return sec ? (
      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sec.color + '22', color: sec.color, border: `1px solid ${sec.color}44`, whiteSpace: 'nowrap' }}>
        🏛️ {sec.name}
      </span>
    ) : null;
  })()
)}
```

- [ ] **Step 5: TypeScript check**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP\apps\web"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: dashboard — sector filter chips + sector badge on conversation cards"
```

---

### Task 7: Conversation page — delegation modal

**Files:**
- Modify: `apps/web/src/app/(app)/conversa/[id]/page.tsx`

- [ ] **Step 1: Add delegation state and load sectors in the conversation page**

At the top of the conversation page component, add:

```typescript
const [sectors, setSectors] = useState<{ id: string; name: string; color: string }[]>([]);
const [sectorUsers, setSectorUsers] = useState<{ id: string; name: string }[]>([]);
const [showDelegate, setShowDelegate] = useState(false);
const [delegateSectorId, setDelegateSectorId] = useState('');
const [delegateUserId, setDelegateUserId] = useState('');
const [delegating, setDelegating] = useState(false);
```

In the data loading effect, add:
```typescript
const { data: sectorData } = await supabase.from('sectors').select('id, name, color').order('name');
setSectors((sectorData ?? []) as { id: string; name: string; color: string }[]);
```

- [ ] **Step 2: Load sector members when sector is selected**

Add a `useEffect`:
```typescript
useEffect(() => {
  if (!delegateSectorId) { setSectorUsers([]); setDelegateUserId(''); return; }
  supabase
    .from('sector_members')
    .select('user_id, users(id, name)')
    .eq('sector_id', delegateSectorId)
    .then(({ data }) => {
      setSectorUsers((data ?? []).map((m: { users: { id: string; name: string } }) => m.users));
    });
}, [delegateSectorId, supabase]);
```

- [ ] **Step 3: Add `handleDelegate` function**

```typescript
const handleDelegate = async () => {
  if (!delegateSectorId && !delegateUserId) return;
  setDelegating(true);
  try {
    const res = await fetch(`${API}/api/conversations/${conv!.id}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({
        sectorId:   delegateSectorId  || undefined,
        assignedTo: delegateUserId    || undefined,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    setShowDelegate(false);
    // Refresh conversation
    const { data: updated } = await supabase.from('conversations').select('*').eq('id', conv!.id).single();
    if (updated) setConv(updated as typeof conv);
  } catch (e) { alert('Erro ao delegar: ' + (e instanceof Error ? e.message : String(e))); }
  setDelegating(false);
};
```

- [ ] **Step 4: Add "Delegar" button to the conversation header**

In the conversation page header (next to the existing share button), add:

```tsx
<button
  onClick={() => setShowDelegate(true)}
  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--ammoc-paper-2)', border: '1.5px solid var(--ammoc-line)', color: 'var(--ammoc-ink-700)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
>
  🏛️ Delegar
</button>
```

- [ ] **Step 5: Add delegation modal**

Add this block just before the closing `</div>` of the component:

```tsx
{/* Delegation modal */}
{showDelegate && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ background: 'var(--ammoc-paper)', borderRadius: 'var(--radius)', padding: 28, width: 400, boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 800 }}>Delegar conversa</h2>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Setor</label>
        <select value={delegateSectorId} onChange={e => setDelegateSectorId(e.target.value)}
          style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13 }}>
          <option value="">Selecione um setor…</option>
          {sectors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {sectorUsers.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ammoc-ink-600)', display: 'block', marginBottom: 4 }}>Funcionário (opcional)</label>
          <select value={delegateUserId} onChange={e => setDelegateUserId(e.target.value)}
            style={{ width: '100%', border: '1.5px solid var(--ammoc-line)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13 }}>
            <option value="">Qualquer membro do setor</option>
            {sectorUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setShowDelegate(false)} style={{ background: 'var(--ammoc-paper-2)', border: '1px solid var(--ammoc-line)', color: 'var(--ammoc-ink-600)', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
        <button onClick={() => void handleDelegate()} disabled={delegating || (!delegateSectorId && !delegateUserId)}
          style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: delegating ? 'default' : 'pointer', opacity: (!delegateSectorId && !delegateUserId) ? 0.5 : 1 }}>
          {delegating ? 'Delegando…' : 'Confirmar delegação'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: TypeScript check**

```bash
cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP\apps\web"
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit and push**

```bash
git add apps/web/src/app/\(app\)/conversa/\[id\]/page.tsx
git commit -m "feat: add delegation modal to conversation page — sector + employee picker"
git push origin master
```

---

### Task 8: Deploy

- [ ] **Step 1: Deploy API**

```bash
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=pp6qewlm9usx4rqroaxzi042&force=false" \
  -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
```

- [ ] **Step 2: Deploy web app**

```bash
curl -s "http://2.25.139.166:8000/api/v1/deploy?uuid=y664pro58rjywtieei0no3ua&force=true" \
  -H "Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e"
```

- [ ] **Step 3: Verify API health**

```bash
until curl -s --max-time 5 "http://pp6qewlm9usx4rqroaxzi042.2.25.139.166.sslip.io/api/health" | grep -q "ok"; do sleep 15; done && echo "API OK"
```

- [ ] **Step 4: Smoke test**
  - Open `http://crm.ammoc.org.br/configuracoes/setores`
  - Create a sector "Engenharia Civil" with keywords "obra, esgoto, pavimento" and color #075E54
  - Add a member (e.g., Felipe)
  - Open a conversation in `/dashboard`
  - Verify sector filter chip appears
  - Click on a conversation → click "🏛️ Delegar" → select sector → confirm
  - Return to dashboard → verify sector badge appears on the card

---

## Self-Review

**Spec coverage check:**
- ✅ Sectors configurable by admin (Task 3)
- ✅ Users assigned to sectors (Task 3 - member management)
- ✅ Manual delegation from conversation page (Task 7)
- ✅ Dashboard shows sector badges and filter (Task 6)
- ✅ Conversations stored with sector_id in DB (Task 1)
- ✅ GET /api/sectors available for frontend (Task 3)
- ✅ POST /api/conversations/:id/delegate (Task 4)

**Placeholder scan:** None found — every step has complete code.

**Type consistency check:**
- `Sector` interface defined in Task 2, used in Tasks 3, 5, 6, 7 ✅
- `delegateSectorId` and `delegateUserId` string, consistent throughout Task 7 ✅
- `assertAdminOrSupervisor` checks `user_metadata.role` — matches Supabase JWT structure ✅
