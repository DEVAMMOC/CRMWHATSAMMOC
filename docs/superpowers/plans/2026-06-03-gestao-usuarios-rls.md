# Gestão de usuários (exclusão + RLS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin pode excluir um usuário (preservando o histórico com autor anonimizado) e a visibilidade do "Meu Painel" segue a matriz de níveis (admin/supervisor=tudo, chefe de setor=setor+próprias, funcionário=próprias/atribuídas).

**Architecture:** Migrações trocam FKs para `SET NULL` (preserva histórico) e corrigem `messages_select` (chefe de setor vê mensagens do setor). Endpoint `DELETE /api/users/:id` (admin) remove de `public.users` + `auth.users` + instância Evolution. Auto-atribuição no Canal ao responder cobre "iniciada".

**Tech Stack:** Supabase (Postgres + Auth Admin via service-role), NestJS, Next.js, Jest.

**Constraints de FK confirmadas (nomes reais):** `attendances_assigned_to_fkey`, `attendance_transfers_from_user_id_fkey`, `attendance_transfers_to_user_id_fkey`, `canal_messages_sent_by_fkey`, `conversations_shared_by_fkey`, `conversations_owner_user_id_fkey`.

**File Structure:**
- Migração FKs + nulabilidade (MCP `apply_migration`).
- Migração RLS `messages_select` (MCP `apply_migration`).
- `apps/api/src/modules/auth/supabase-admin.service.ts` — método `deleteAuthUser`.
- `apps/api/src/modules/users/users.service.ts` — `deleteUser` + Logger + novas deps.
- `apps/api/src/modules/users/users.module.ts` — prover `EvolutionService`, injetar admin+evo no `UsersService`.
- `apps/api/src/modules/users/users.controller.ts` — `DELETE :id`.
- `apps/api/src/modules/users/users.service.spec.ts` — atualizar construtor + testes de `deleteUser`.
- `apps/api/src/modules/canal/canal-conversation.service.ts` — auto-assign em `reply`/`sendMediaMessage`.
- `apps/api/src/modules/canal/canal-conversation.service.spec.ts` — teste do auto-assign.
- `apps/web/src/app/(app)/equipe/page.tsx` — botão "Excluir".

---

### Task 1: Migração — FKs SET NULL + colunas nuláveis (preservar histórico)

**Files:** DB via MCP `mcp__supabase__apply_migration` (ref `xfqphbdurynuwvrnxpvj`).

- [ ] **Step 1: Aplicar a migração** — `name: "preserve_history_on_user_delete"`, query:

```sql
-- tornar nuláveis as colunas de autor que hoje são NOT NULL
alter table public.attendances alter column assigned_to drop not null;
alter table public.attendance_transfers alter column from_user_id drop not null;
alter table public.attendance_transfers alter column to_user_id drop not null;
alter table public.conversations alter column owner_user_id drop not null;

-- recriar as FKs como ON DELETE SET NULL (preserva as linhas com autor nulo)
alter table public.attendances drop constraint attendances_assigned_to_fkey;
alter table public.attendances add constraint attendances_assigned_to_fkey
  foreign key (assigned_to) references public.users(id) on delete set null;

alter table public.attendance_transfers drop constraint attendance_transfers_from_user_id_fkey;
alter table public.attendance_transfers add constraint attendance_transfers_from_user_id_fkey
  foreign key (from_user_id) references public.users(id) on delete set null;

alter table public.attendance_transfers drop constraint attendance_transfers_to_user_id_fkey;
alter table public.attendance_transfers add constraint attendance_transfers_to_user_id_fkey
  foreign key (to_user_id) references public.users(id) on delete set null;

alter table public.canal_messages drop constraint canal_messages_sent_by_fkey;
alter table public.canal_messages add constraint canal_messages_sent_by_fkey
  foreign key (sent_by) references public.users(id) on delete set null;

alter table public.conversations drop constraint conversations_shared_by_fkey;
alter table public.conversations add constraint conversations_shared_by_fkey
  foreign key (shared_by) references public.users(id) on delete set null;

-- conversas pessoais: preservar (era CASCADE → vira SET NULL)
alter table public.conversations drop constraint conversations_owner_user_id_fkey;
alter table public.conversations add constraint conversations_owner_user_id_fkey
  foreign key (owner_user_id) references public.users(id) on delete set null;
```

- [ ] **Step 2: Verificar** — `mcp__supabase__execute_sql`:

```sql
select tc.table_name, kcu.column_name, rc.delete_rule
from information_schema.referential_constraints rc
join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
join information_schema.key_column_usage kcu on kcu.constraint_name = rc.constraint_name
join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.constraint_name
where ccu.table_name='users' and ccu.table_schema='public'
  and tc.table_name in ('attendances','attendance_transfers','canal_messages','conversations')
order by tc.table_name, kcu.column_name;
```
Esperado: `assigned_to`, `from_user_id`, `to_user_id`, `sent_by`, `shared_by`, `owner_user_id` todas com `delete_rule = SET NULL`.

- [ ] **Step 3: Commit (registro)**

```bash
git commit --allow-empty -m "feat(db): FKs de usuário ON DELETE SET NULL (preserva histórico) via MCP"
```

---

### Task 2: Migração — corrigir `messages_select` (chefe de setor vê mensagens do setor)

**Files:** DB via MCP `mcp__supabase__apply_migration`.

- [ ] **Step 1: Aplicar** — `name: "messages_select_sector_lead"`, query:

```sql
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
      and ( c.owner_user_id = auth.uid()
            or current_user_role() = any (array['supervisor','admin']::user_role[])
            or (c.sector_id is not null and leads_sector(c.sector_id)) )
  )
);
```

- [ ] **Step 2: Verificar** — `mcp__supabase__execute_sql`:

```sql
select qual from pg_policies where tablename='messages' and policyname='messages_select';
```
Esperado: a expressão contém `leads_sector`.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "feat(db): messages_select inclui chefe de setor (leads_sector) via MCP"
```

---

### Task 3: `SupabaseAdminService.deleteAuthUser`

**Files:**
- Modify: `apps/api/src/modules/auth/supabase-admin.service.ts`
- Test: `apps/api/src/modules/auth/supabase-admin.service.spec.ts` (criar)

- [ ] **Step 1: Teste que falha** — criar `supabase-admin.service.spec.ts`:

```typescript
import { SupabaseAdminService } from './supabase-admin.service';
import { ConfigService } from '@nestjs/config';

const cfg = { getOrThrow: (k: string) => k.includes('url') ? 'http://localhost' : 'service-role-key' } as unknown as ConfigService;

describe('SupabaseAdminService.deleteAuthUser', () => {
  it('chama auth.admin.deleteUser e lança em erro', async () => {
    const svc = new SupabaseAdminService(cfg);
    const del = jest.fn().mockResolvedValue({ data: {}, error: null });
    // injeta um client falso
    (svc as unknown as { client: { auth: { admin: { deleteUser: jest.Mock } } } }).client = {
      auth: { admin: { deleteUser: del } },
    };
    await svc.deleteAuthUser('uid-1');
    expect(del).toHaveBeenCalledWith('uid-1');

    del.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(svc.deleteAuthUser('uid-2')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd apps/api && npx jest src/modules/auth/supabase-admin.service.spec.ts` → FAIL (`deleteAuthUser` não existe).

- [ ] **Step 3: Implementar** — adicionar ao `SupabaseAdminService` (após `getUser`):

```typescript
  async deleteAuthUser(id: string): Promise<void> {
    const { error } = await this.client.auth.admin.deleteUser(id);
    if (error) throw new Error(error.message);
  }
```

- [ ] **Step 4: Rodar e ver passar** — `cd apps/api && npx jest src/modules/auth/supabase-admin.service.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/supabase-admin.service.ts apps/api/src/modules/auth/supabase-admin.service.spec.ts
git commit -m "feat(api): SupabaseAdminService.deleteAuthUser"
```

---

### Task 4: `UsersService.deleteUser` + wiring + endpoint

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`
- Modify: `apps/api/src/modules/users/users.controller.ts`
- Test: `apps/api/src/modules/users/users.service.spec.ts`

- [ ] **Step 1: Atualizar o construtor do `UsersService`**
Em `users.service.ts`, ajustar imports e construtor:

```typescript
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { EvolutionService } from '../whatsapp/evolution.service';
// ...
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly supabaseAdmin: SupabaseAdminService,
    private readonly evolution: EvolutionService,
  ) {}
```

- [ ] **Step 2: Implementar `deleteUser`** (adicionar ao service):

```typescript
  async deleteUser(callerId: string, targetId: string): Promise<void> {
    const { data: caller } = await this.supabase
      .from('users').select('role').eq('id', callerId).single();
    if (!caller || (caller as { role: string }).role !== 'admin') {
      throw new ForbiddenException('Apenas administradores podem excluir usuários');
    }
    if (callerId === targetId) {
      throw new BadRequestException('Você não pode excluir a si mesmo');
    }
    const { data: target } = await this.supabase
      .from('users').select('role, evolution_instance_id').eq('id', targetId).single();
    if (!target) throw new NotFoundException('Usuário não encontrado');
    const t = target as { role: string; evolution_instance_id: string | null };

    if (t.role === 'admin') {
      const { count } = await this.supabase
        .from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
      if ((count ?? 0) <= 1) {
        throw new BadRequestException('Não é possível excluir o último administrador');
      }
    }

    if (t.evolution_instance_id) {
      try { await this.evolution.deleteInstance(t.evolution_instance_id); }
      catch (e) { this.logger.warn(`Falha ao excluir instância Evolution: ${e instanceof Error ? e.message : String(e)}`); }
    }

    const { error: delErr } = await this.supabase.from('users').delete().eq('id', targetId);
    if (delErr) throw new Error(delErr.message);

    await this.supabaseAdmin.deleteAuthUser(targetId);
    this.logger.log(`Usuário ${targetId} excluído por ${callerId}`);
  }
```

- [ ] **Step 3: Wiring do módulo** — em `users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { AuthModule } from '../auth/auth.module';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { EvolutionService } from '../whatsapp/evolution.service';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

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
      provide: UsersService,
      inject: ['SUPABASE_CLIENT', SupabaseAdminService, EvolutionService],
      useFactory: (
        supabase: ReturnType<typeof createClient>,
        admin: SupabaseAdminService,
        evo: EvolutionService,
      ) => new UsersService(supabase, admin, evo),
    },
  ],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
```
(`SupabaseAdminService` vem do `AuthModule` (exportado); `EvolutionService` precisa de `ConfigService`, disponível via `ConfigModule` global.)

- [ ] **Step 4: Endpoint no controller** — em `users.controller.ts`, adicionar imports `Delete, Param` e o método:

```typescript
  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    await this.usersService.deleteUser(user.id, id);
    return { ok: true };
  }
```

- [ ] **Step 5: Atualizar o spec** — em `users.service.spec.ts`, atualizar a construção e adicionar testes.
Trocar a criação do service no `beforeEach`:

```typescript
const mockAdmin = { deleteAuthUser: jest.fn().mockResolvedValue(undefined) };
const mockEvo = { deleteInstance: jest.fn().mockResolvedValue(undefined) };
// ...
service = new UsersService(mockSupabase as never, mockAdmin as never, mockEvo as never);
```

Adicionar testes de `deleteUser` (usam um supabase mock dedicado por chamada):

```typescript
describe('deleteUser', () => {
  const makeSupa = (calls: Record<string, unknown>) => {
    // calls: { callerRole, target, adminCount }
    return {
      from: jest.fn((table: string) => ({
        select: (_c?: unknown, _o?: unknown) => ({
          eq: (_col: string, val: string) => ({
            single: async () => {
              if (val === 'caller') return { data: { role: (calls.callerRole as string) }, error: null };
              return { data: calls.target ?? null, error: null };
            },
            // head:true count path (.eq retorna objeto com count)
            then: undefined,
          }),
        }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      })),
    };
  };

  it('bloqueia não-admin', async () => {
    const supa = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'funcionario' }, error: null }) }) }) }),
    };
    const svc = new UsersService(supa as never, mockAdmin as never, mockEvo as never);
    await expect(svc.deleteUser('caller', 'target')).rejects.toThrow('administradores');
  });

  it('bloqueia auto-exclusão', async () => {
    const supa = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'admin' }, error: null }) }) }) }),
    };
    const svc = new UsersService(supa as never, mockAdmin as never, mockEvo as never);
    await expect(svc.deleteUser('same', 'same')).rejects.toThrow('si mesmo');
  });

  it('caminho feliz: deleta public + auth', async () => {
    const del = jest.fn(() => ({ eq: async () => ({ error: null }) }));
    const supa = {
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn((_c: string, val: string) => ({
            single: async () => val === 'caller'
              ? { data: { role: 'admin' }, error: null }
              : { data: { role: 'funcionario', evolution_instance_id: null }, error: null },
          })),
        })),
        delete: del,
      })),
    };
    const admin = { deleteAuthUser: jest.fn().mockResolvedValue(undefined) };
    const svc = new UsersService(supa as never, admin as never, mockEvo as never);
    await svc.deleteUser('caller', 'target');
    expect(del).toHaveBeenCalled();
    expect(admin.deleteAuthUser).toHaveBeenCalledWith('target');
  });
});
```

> Nota: os testes acima focam nos guards e no caminho feliz de funcionário (sem checagem de "último admin", que só roda quando o alvo é admin). Mantêm o mock simples por chamada.

- [ ] **Step 6: Rodar testes** — `cd apps/api && npx jest src/modules/users` → todos passam. Rodar `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/users/
git commit -m "feat(api): DELETE /users/:id (admin) — remove public+auth, preserva histórico"
```

---

### Task 5: Frontend `/equipe` — botão "Excluir"

**Files:**
- Modify: `apps/web/src/app/(app)/equipe/page.tsx`

- [ ] **Step 1: Passar handler de exclusão ao `UserCard`**
No `EquipePage`, adicionar (após `handleRoleChange`):

```typescript
  const handleDelete = useCallback(async (userId: string, name: string) => {
    if (!confirm(`Excluir o usuário "${name}"? Esta ação é irreversível. O histórico de atendimentos é preservado.`)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(`${getApiBase()}/api/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? 'Erro ao excluir');
    }
    setUsers(prev => prev.filter(u => u.id !== userId));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
Adicionar o import no topo: `import { getApiBase } from '@/lib/api-base';`
E passar ao card: `<UserCard ... canDelete={canEdit && u.id !== currentUser?.id} onDelete={handleDelete} />`.

- [ ] **Step 2: Botão no `UserCard`**
Estender as props e adicionar o botão (depois do bloco de "Alterar papel"):

```typescript
function UserCard({
  user, canEdit, onRoleChange, canDelete, onDelete,
}: {
  user: AppUser;
  canEdit: boolean;
  onRoleChange: (userId: string, newRole: UserRole) => Promise<void>;
  canDelete: boolean;
  onDelete: (userId: string, name: string) => Promise<void>;
}) {
  // ... estado existente ...
  const [deleting, setDeleting] = useState(false);

  async function handleDeleteClick() {
    setDeleting(true); setFeedback(null);
    try { await onDelete(user.id, user.name); }
    catch (err: unknown) { setFeedback({ ok: false, msg: err instanceof Error ? err.message : 'Erro ao excluir.' }); setDeleting(false); }
  }
  // ... no JSX, após o bloco canEdit de papel:
}
```
JSX do botão (dentro do card):

```tsx
      {canDelete && (
        <button
          onClick={handleDeleteClick}
          disabled={deleting}
          style={{ fontSize: 12, fontWeight: 600, color: '#C0392B', background: '#FCEBE8',
            border: '1px solid #f5c6c0', borderRadius: 'var(--radius-sm)', padding: '4px 10px',
            cursor: deleting ? 'default' : 'pointer' }}>
          {deleting ? 'Excluindo…' : 'Excluir'}
        </button>
      )}
```

- [ ] **Step 3: Build do web** — `cd "C:\Users\max_m\OneDrive\Área de Trabalho\GERENCIAMENTO WHATSAPP" && pnpm --filter @crmwhats/web build` (compila+lint+typecheck; o passo final de symlink falha no Windows/OneDrive — ignorar esse EPERM, é ambiente).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/equipe/page.tsx"
git commit -m "feat(web): botão Excluir usuário na /equipe (admin)"
```

---

### Task 6: Auto-atribuição no Canal ("iniciada/respondida")

**Files:**
- Modify: `apps/api/src/modules/canal/canal-conversation.service.ts`
- Test: `apps/api/src/modules/canal/canal-conversation.service.spec.ts`

- [ ] **Step 1: Teste que falha** — adicionar em `canal-conversation.service.spec.ts`:

```typescript
describe('CanalConversationService.reply auto-assign', () => {
  it('atribui ao remetente quando assigned_to é nulo', async () => {
    const updateArg: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'c1', wa_contact_number: '5549999', last_in_at: new Date().toISOString(),
            assigned_to: null, canal_numbers: { phone_number_id: 'PN' },
          } }) }) }),
          update: (arg: Record<string, unknown>) => { Object.assign(updateArg, arg); return { eq: async () => ({}) }; },
        };
        if (table === 'canal_messages') return { insert: async () => ({ error: null }) };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true, wa_message_id: 'x' }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);
    await svc.reply('c1', 'user-1', 'oi');
    expect(updateArg.assigned_to).toBe('user-1');
  });

  it('NÃO rouba atribuição existente', async () => {
    const updateArg: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((table: string) => {
        if (table === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: {
            id: 'c1', wa_contact_number: '5549999', last_in_at: new Date().toISOString(),
            assigned_to: 'outro', canal_numbers: { phone_number_id: 'PN' },
          } }) }) }),
          update: (arg: Record<string, unknown>) => { Object.assign(updateArg, arg); return { eq: async () => ({}) }; },
        };
        if (table === 'canal_messages') return { insert: async () => ({ error: null }) };
        return {};
      }),
    } as unknown as SupabaseClient;
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true, wa_message_id: 'x' }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa, meta);
    await svc.reply('c1', 'user-1', 'oi');
    expect(updateArg.assigned_to).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts` → o 1º novo teste FALHA (hoje `reply` não seta `assigned_to`).

- [ ] **Step 3: Implementar** — em `reply()`, ajustar o `select` e o `update` finais.
No `select` da conversa, incluir `assigned_to` (e o `cc` typing). Trocar o bloco final `update({ last_message_at, status })` por:

```typescript
    const patch: Record<string, unknown> = { last_message_at: now, status: 'human' };
    if (!cc.assigned_to) patch.assigned_to = userId;
    await this.supabase
      .from('canal_conversations')
      .update(patch)
      .eq('id', conversationId);
```
Onde `cc` agora também tem `assigned_to: string | null` no cast, e o `.select(...)` da conversa inclui `assigned_to`. Aplicar o MESMO padrão em `sendMediaMessage()` (incluir `assigned_to` no select e no patch final).

- [ ] **Step 4: Rodar e ver passar** — `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts` → todos passam. `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/canal/canal-conversation.service.ts apps/api/src/modules/canal/canal-conversation.service.spec.ts
git commit -m "feat(api): Canal auto-atribui ao responder conversa sem dono"
```

---

### Task 7: Verificação RLS, build, deploy

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte completa + build API** — `cd apps/api && npx jest` (verde) e `cd "...GERENCIAMENTO WHATSAPP" && pnpm --filter @crmwhats/api build`.

- [ ] **Step 2: Verificar a matriz de RLS via SQL** — `mcp__supabase__execute_sql`, simulando um funcionário (felipe `aae728eb-d447-4c17-bc5f-49f996623203`) e contando o que ele vê:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aae728eb-d447-4c17-bc5f-49f996623203","role":"authenticated"}';
select
  (select count(*) from public.conversations) as conv_visiveis,
  (select count(*) from public.canal_conversations) as canal_visiveis;
rollback;
```
Esperado: counts refletindo só as próprias/atribuídas do felipe (não as de outros). (Confirma que a política não vazou; ajustar se algo destoar.)

- [ ] **Step 3: Push + deploy (Coolify)**

```bash
git push origin master
```
API uuid `pp6qewlm9usx4rqroaxzi042`, WEB uuid `y664pro58rjywtieei0no3ua` — `GET http://2.25.139.166:8000/api/v1/deploy?uuid=<uuid>&force=false` header `Authorization: Bearer 4|eapzDjDej8MwupomynOjKRtnV94SWwZM4ds9EK8s51423d3e`.

- [ ] **Step 4: Verificação ao vivo** — confirmar deploy (rota nova: `DELETE /api/users/<id>` sem token → 401, antes era 404). Na `/equipe` logado como admin, excluir um usuário de teste e confirmar que some; conferir no Supabase que o `auth.users` e `public.users` sumiram e que um atendimento dele (se houver) ficou com `assigned_to` nulo.

- [ ] **Step 5: Atualizar handoff** — registrar exclusão de usuário + correção de `messages_select` + auto-assign no Canal em `memory/handoff-estado-projeto.md`.

---

## Self-Review

- **Cobertura do spec:** exclusão (Tasks 1,3,4,5) · preservar histórico (Task 1 SET NULL) · matriz RLS / gap messages_select (Task 2) · auto-assign Canal (Task 6) · supervisor inalterado (nenhuma task mexe) · testes+deploy (Tasks 4,6,7). ✓
- **Placeholders:** todos os passos de código têm código real; nomes de constraint reais; nenhuma referência a símbolo indefinido. ✓
- **Consistência de tipos:** `deleteUser(callerId, targetId)` usado igual no controller e service; `deleteAuthUser(id)` igual no admin service e na chamada; `canDelete/onDelete` props batem entre `EquipePage` e `UserCard`; `assigned_to` adicionado ao select e ao patch em `reply`/`sendMediaMessage`. ✓
