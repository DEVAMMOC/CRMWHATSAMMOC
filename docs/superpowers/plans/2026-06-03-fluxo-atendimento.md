# Fluxo de atendimento + visibilidade + card + sino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Canal: delegar→"Aguardando" no painel do destinatário, botão "Assumir", transferência, mensagens de sistema (interno + cidadão), card com status/setor/cidade/assunto editável; número pessoal: compartilhar→visível na hora; notificações num sino no topo (fora do menu).

**Tech Stack:** NestJS, Next.js, Supabase, Jest. Deploy via Coolify.

**File map:**
- DB migração (MCP): colunas em `canal_conversations`, `canal_messages`, `conversations`.
- `packages/types/src/index.ts` — tipos.
- `apps/api/src/modules/canal/canal-conversation.service.ts` — delegate/assume/setMeta/systemEvent/notifyCitizen.
- `apps/api/src/modules/canal/canal-inbox.controller.ts` — endpoints assume/meta.
- `apps/api/src/modules/canal/dto/set-meta.dto.ts` — novo.
- `apps/api/src/modules/whatsapp/conversation-share.controller.ts` — share→ativa.
- `apps/web/src/components/layout/NotificationBell.tsx` — novo; `AppShellClient.tsx`, `Sidebar.tsx` — integração/remover item.
- `apps/web/src/app/(app)/canal/CanalPanel.tsx`, `canal/page.tsx`, `kanban/page.tsx` — card/assumir/meta/pílulas.

---

### Task 1: Migração — colunas novas (MCP, executada pelo controlador)

- [ ] **Step 1:** `mcp__supabase__apply_migration` name `fluxo_atendimento_cols`:
```sql
alter table public.canal_conversations
  add column if not exists subject text,
  add column if not exists municipality text,
  add column if not exists assumed_by uuid references public.users(id) on delete set null,
  add column if not exists assumed_at timestamptz;
alter table public.canal_messages
  add column if not exists is_system boolean not null default false;
alter table public.conversations
  add column if not exists subject text;
```
- [ ] **Step 2:** Verificar via `execute_sql` que as colunas existem.
- [ ] **Step 3:** `git commit --allow-empty -m "feat(db): colunas do fluxo de atendimento (via MCP)"`

---

### Task 2: Tipos (`packages/types/src/index.ts`)

- [ ] **Step 1:** Em `CanalMessage`, adicionar `is_system: boolean;`.
- [ ] **Step 2:** Localizar a interface `CanalConversation` e adicionar:
```typescript
  subject: string | null;
  municipality: string | null;
  assumed_by: string | null;
  assumed_at: string | null;
```
- [ ] **Step 3:** `cd "<repo>" && pnpm --filter @crmwhats/types build` (tsc) — sem erros.
- [ ] **Step 4:** commit `feat(types): campos do fluxo de atendimento`.

---

### Task 3: Serviço Canal — delegate/assume/setMeta + helpers

**Files:** `apps/api/src/modules/canal/canal-conversation.service.ts` (+ spec).

Contexto: a classe tem `this.supabase`, `this.meta` (MetaService), `this.logger`. Já existe `notifyAssignment`. Constantes: janela 24h. Padrões de cast `cc as { ... }`.

- [ ] **Step 1: Helpers** — adicionar à classe:
```typescript
  /** Evento interno na timeline (pílula no chat). Não envia nada à Meta. */
  private async systemEvent(conversationId: string, text: string): Promise<void> {
    await this.supabase.from('canal_messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      content: text,
      message_type: 'text',
      is_system: true,
      sent_at: new Date().toISOString(),
    });
  }

  /** Aviso ao cidadão por WhatsApp, só se dentro da janela de 24h da Meta. */
  private async notifyCitizen(conversationId: string, text: string): Promise<void> {
    const { data } = await this.supabase
      .from('canal_conversations')
      .select('wa_contact_number, last_in_at, canal_numbers(phone_number_id)')
      .eq('id', conversationId)
      .single();
    const c = data as unknown as {
      wa_contact_number: string; last_in_at: string | null;
      canal_numbers: { phone_number_id: string };
    } | null;
    if (!c) return;
    if (!c.last_in_at || Date.now() - new Date(c.last_in_at).getTime() > 24 * 60 * 60 * 1000) {
      this.logger.log(`notifyCitizen ${conversationId}: fora da janela 24h — só evento interno`);
      return;
    }
    const r = await this.meta.sendText(c.canal_numbers.phone_number_id, c.wa_contact_number, text);
    if (!r.ok) this.logger.warn(`notifyCitizen falhou: ${r.error}`);
  }

  private async userName(id: string | null): Promise<string> {
    if (!id) return 'a equipe';
    const { data } = await this.supabase.from('users').select('name').eq('id', id).single();
    return (data as { name: string } | null)?.name ?? 'a equipe';
  }

  private async sectorName(id: string | null): Promise<string> {
    if (!id) return '';
    const { data } = await this.supabase.from('sectors').select('name').eq('id', id).single();
    return (data as { name: string } | null)?.name ?? '';
  }
```

- [ ] **Step 2: Reescrever `delegate`** (status→open + detecta transferência + eventos). Substituir o método atual por:
```typescript
  async delegate(
    conversationId: string,
    sectorId: string | null,
    assignedTo: string | null,
  ): Promise<void> {
    const { data: prev } = await this.supabase
      .from('canal_conversations')
      .select('assigned_to')
      .eq('id', conversationId)
      .single();
    const prevAssigned = (prev as { assigned_to: string | null } | null)?.assigned_to ?? null;

    const { error } = await this.supabase
      .from('canal_conversations')
      .update({ sector_id: sectorId, assigned_to: assignedTo, status: 'open' })
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);

    // Eventos: transferência (troca de responsável) tem prioridade sobre delegação a setor.
    if (assignedTo && prevAssigned && assignedTo !== prevAssigned) {
      const nome = await this.userName(assignedTo);
      await this.systemEvent(conversationId, `↪️ Direcionado para ${nome}`);
      await this.notifyCitizen(conversationId, `Seu atendimento foi direcionado para ${nome}.`).catch(() => {});
    } else if (sectorId) {
      const setor = await this.sectorName(sectorId);
      await this.systemEvent(conversationId, `🔀 Delegado ao setor ${setor}`);
      await this.notifyCitizen(conversationId, `Seu atendimento foi encaminhado ao setor ${setor}.`).catch(() => {});
    }

    if (assignedTo) {
      await this.notifyAssignment(conversationId, assignedTo, sectorId).catch((e) =>
        this.logger.warn(`Falha ao notificar delegação: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }
```

- [ ] **Step 3: `assume`** — adicionar:
```typescript
  /** Funcionário assume a conversa (Aguardando → Em atendimento). */
  async assume(conversationId: string, userId: string): Promise<void> {
    const { data: conv } = await this.supabase
      .from('canal_conversations')
      .select('assigned_to')
      .eq('id', conversationId)
      .single();
    if (!conv) throw new NotFoundException('Conversa não encontrada');
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('canal_conversations')
      .update({ status: 'human', assigned_to: userId, assumed_by: userId, assumed_at: now })
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
    const nome = await this.userName(userId);
    await this.systemEvent(conversationId, `✋ ${nome} assumiu o atendimento`);
    await this.notifyCitizen(conversationId, `Olá! Sou ${nome} e vou seguir com o seu atendimento.`).catch(() => {});
  }
```

- [ ] **Step 4: `setMeta`** — adicionar:
```typescript
  /** Atualiza assunto/cidade da conversa do Canal. */
  async setMeta(
    conversationId: string,
    patch: { subject?: string | null; municipality?: string | null },
  ): Promise<void> {
    const updates: Record<string, unknown> = {};
    if (patch.subject !== undefined) updates.subject = patch.subject;
    if (patch.municipality !== undefined) updates.municipality = patch.municipality;
    if (Object.keys(updates).length === 0) return;
    const { error } = await this.supabase
      .from('canal_conversations')
      .update(updates)
      .eq('id', conversationId);
    if (error) throw new BadRequestException(error.message);
  }
```

- [ ] **Step 5: Testes** — em `canal-conversation.service.spec.ts`, adicionar:
```typescript
describe('CanalConversationService.delegate/assume/setMeta', () => {
  const baseSupa = (over: Record<string, (t: string) => unknown> = {}) => {
    const calls: Record<string, unknown> = {};
    const supa = {
      from: jest.fn((t: string) => {
        if (over[t]) return over[t](t);
        if (t === 'canal_conversations') return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { assigned_to: calls.prevAssigned ?? null }, error: null }) }) }),
          update: (arg: Record<string, unknown>) => { calls[`upd_${t}`] = arg; return { eq: async () => ({ error: null }) }; },
        };
        if (t === 'canal_messages') return { insert: (arg: Record<string, unknown>) => { calls.sysmsg = arg; return Promise.resolve({ error: null }); } };
        if (t === 'users') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Felipe' } }) }) }) };
        if (t === 'sectors') return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: 'Tributos' } }) }) }) };
        if (t === 'notifications') return { insert: async () => ({ error: null }) };
        return {};
      }),
    };
    return { supa, calls };
  };

  it('delegate seta status open e gera evento de setor', async () => {
    const { supa, calls } = baseSupa();
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa as never, meta);
    await svc.delegate('c1', 'sec1', null);
    expect((calls['upd_canal_conversations'] as { status: string }).status).toBe('open');
    expect((calls.sysmsg as { content: string; is_system: boolean }).is_system).toBe(true);
    expect((calls.sysmsg as { content: string }).content).toContain('setor Tributos');
  });

  it('assume seta human + assumed_by e evento', async () => {
    const { supa, calls } = baseSupa();
    const meta = { sendText: jest.fn().mockResolvedValue({ ok: true }) } as unknown as MetaService;
    const svc = new CanalConversationService(supa as never, meta);
    await svc.assume('c1', 'u1');
    const upd = calls['upd_canal_conversations'] as { status: string; assumed_by: string };
    expect(upd.status).toBe('human');
    expect(upd.assumed_by).toBe('u1');
    expect((calls.sysmsg as { content: string }).content).toContain('assumiu');
  });

  it('setMeta grava subject/municipality', async () => {
    const { supa, calls } = baseSupa();
    const meta = {} as unknown as MetaService;
    const svc = new CanalConversationService(supa as never, meta);
    await svc.setMeta('c1', { subject: 'IPTU', municipality: 'Joaçaba' });
    const upd = calls['upd_canal_conversations'] as { subject: string; municipality: string };
    expect(upd.subject).toBe('IPTU');
    expect(upd.municipality).toBe('Joaçaba');
  });
});
```
Rodar `cd apps/api && npx jest src/modules/canal/canal-conversation.service.spec.ts` (vermelho→implementar→verde) e `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 6:** commit `feat(api): Canal delegate(aguardando+transfer)/assume/setMeta + mensagens de sistema`.

---

### Task 4: Endpoints assume + meta (`canal-inbox.controller.ts` + DTO)

- [ ] **Step 1:** Criar `apps/api/src/modules/canal/dto/set-meta.dto.ts`:
```typescript
import { IsString, IsOptional } from 'class-validator';
export class CanalSetMetaDto {
  @IsString() @IsOptional() subject?: string;
  @IsString() @IsOptional() municipality?: string;
}
```
- [ ] **Step 2:** Em `canal-inbox.controller.ts` importar `CanalSetMetaDto` e adicionar:
```typescript
  @Post(':id/assume')
  assume(@CurrentUser() user: User, @Param('id') id: string) {
    return this.convs.assume(id, user.id);
  }

  @Post(':id/meta')
  setMeta(@Param('id') id: string, @Body() dto: CanalSetMetaDto) {
    return this.convs.setMeta(id, { subject: dto.subject, municipality: dto.municipality });
  }
```
- [ ] **Step 3:** `cd apps/api && npx jest && npx tsc --noEmit -p tsconfig.json` (verde).
- [ ] **Step 4:** commit `feat(api): endpoints Canal assume + meta`.

---

### Task 5: Compartilhar pessoal → visível na hora (`conversation-share.controller.ts`)

- [ ] **Step 1:** No método `share`, trocar o update de `status: 'pendente'` por `status: 'ativa'`, e a mensagem de retorno `status: 'pendente'` → `status: 'ativa'` e o texto para `'Conversa compartilhada e visível no painel'`. Manter a checagem `if (conv.status !== 'nao_salva') return ...` e o `generateMd`.
- [ ] **Step 2:** `cd apps/api && npx tsc --noEmit -p tsconfig.json`.
- [ ] **Step 3:** commit `feat(api): compartilhar conversa pessoal fica ativa (sem aceitação)`.

---

### Task 6: Sino de notificações no topo

**Files:** criar `apps/web/src/components/layout/NotificationBell.tsx`; editar `AppShellClient.tsx`; editar `Sidebar.tsx`.

- [ ] **Step 1:** Criar `NotificationBell.tsx`:
```tsx
'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface Notif { id: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string; }

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, link, read, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    const list = (data ?? []) as Notif[];
    setItems(list);
    setUnread(list.filter(n => !n.read).length);
  }, []);

  useEffect(() => { void load(); const iv = setInterval(() => void load(), 20000); return () => clearInterval(iv); }, [load]);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function openItem(n: Notif) {
    const supabase = createClient();
    if (!n.read) { await supabase.from('notifications').update({ read: true }).eq('id', n.id); }
    setOpen(false);
    await load();
    if (n.link) router.push(n.link);
  }
  async function markAll() {
    const supabase = createClient();
    await supabase.from('notifications').update({ read: true }).eq('read', false);
    await load();
  }

  return (
    <div ref={ref} style={{ position: 'fixed', top: 12, right: 16, zIndex: 200 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-label="Notificações"
        style={{ position: 'relative', width: 40, height: 40, borderRadius: '50%', border: '1px solid var(--ammoc-line-2)', background: 'var(--ammoc-paper)', cursor: 'pointer', fontSize: 18, boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}>
        🔔
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#C0392B', color: 'white', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{unread}</span>
        )}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 48, right: 0, width: 320, maxHeight: 420, overflowY: 'auto', background: 'var(--ammoc-paper)', border: '1px solid var(--ammoc-line-2)', borderRadius: 'var(--radius)', boxShadow: '0 8px 28px rgba(0,0,0,.18)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--ammoc-line-2)' }}>
            <strong style={{ fontSize: 13 }}>Notificações</strong>
            <button type="button" onClick={() => void markAll()} style={{ background: 'none', border: 'none', color: 'var(--ammoc-green-700)', fontSize: 11, cursor: 'pointer' }}>marcar todas lidas</button>
          </div>
          {items.length === 0 ? (
            <div style={{ padding: 16, fontSize: 13, color: 'var(--ammoc-ink-400)', textAlign: 'center' }}>Sem notificações</div>
          ) : items.map(n => (
            <div key={n.id} onClick={() => void openItem(n)} style={{ padding: '10px 14px', borderBottom: '1px solid var(--ammoc-line-2)', cursor: 'pointer', background: n.read ? 'transparent' : 'var(--ammoc-green-100)' }}>
              <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: 'var(--ammoc-ink-900)' }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 12, color: 'var(--ammoc-ink-500)' }}>{n.body}</div>}
            </div>
          ))}
          <div onClick={() => { setOpen(false); router.push('/notificacoes'); }} style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, color: 'var(--ammoc-green-700)', cursor: 'pointer' }}>ver todas</div>
        </div>
      )}
    </div>
  );
}
```
- [ ] **Step 2:** Em `AppShellClient.tsx`, importar `NotificationBell` e renderizá-lo dentro do `shell` (uma vez), por ex. logo após `<header>`: `<NotificationBell />`.
- [ ] **Step 3:** Em `Sidebar.tsx`: remover o item `{ icon: '🔔', label: 'Notificações', href: '/notificacoes' }` de `WHATSAPP_NAV`; remover o estado `unread`/`useEffect` de contagem e simplificar o map do `WHATSAPP_NAV` para `{WHATSAPP_NAV.map(item => <NavLink ... item={item} />)}` (sem o badge especial).
- [ ] **Step 4:** `pnpm --filter @crmwhats/web build` (compila/lint/typecheck; ignorar EPERM de symlink final).
- [ ] **Step 5:** commit `feat(web): sino de notificações no topo (remove item do menu)`.

---

### Task 7: CanalPanel — pílulas de sistema + Assumir + meta editável + header

**Files:** `apps/web/src/app/(app)/canal/CanalPanel.tsx`. LER o arquivo antes.

- [ ] **Step 1:** Pílula de sistema: dentro do `.map(m => ...)`, ANTES do `return` da bolha normal, tratar `m.is_system`:
```tsx
          if (m.is_system) {
            return (
              <div key={m.id} style={{ alignSelf: 'center', maxWidth: '80%', background: 'var(--ammoc-paper-3)', color: 'var(--ammoc-ink-600)', borderRadius: 999, padding: '4px 12px', fontSize: 11.5, fontWeight: 600 }}>
                {m.content} · {fmtTime(m.sent_at)}
              </div>
            );
          }
```
(`CanalMessage` já tem `is_system` após Task 2.)

- [ ] **Step 2:** Botão "Assumir atendimento": no cabeçalho, quando `status === 'open'`, antes do botão Delegar, adicionar:
```tsx
          {status === 'open' && (
            <button type="button" onClick={() => void handleAssume()}
              style={{ background: 'var(--ammoc-green)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ✋ Assumir
            </button>
          )}
```
E o handler:
```tsx
  async function handleAssume() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/canal/conversations/${conversationId}/assume`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { const b = await res.json().catch(() => ({ message: res.statusText })); throw new Error(b.message ?? 'Erro ao assumir'); }
      onChanged?.(); await loadMessages();
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao assumir'); }
  }
```

- [ ] **Step 3:** Assunto/cidade editáveis no cabeçalho: abaixo da linha de nome/numero, mostrar setor (se houver), cidade e assunto com edição inline. Estado:
```tsx
  const [editingMeta, setEditingMeta] = useState(false);
  const [subject, setSubject] = useState('');
  const [municipality, setMunicipality] = useState('');
```
Adicionar, no cabeçalho (após o bloco de número), um pequeno bloco que mostra `📍 {cidade}` e `🏷️ {assunto}` quando houver, com um link "editar" que abre dois inputs e um "salvar":
```tsx
  async function saveMeta() {
    if (!token) return;
    const res = await fetch(`${API}/api/canal/conversations/${conversationId}/meta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ subject: subject.trim() || undefined, municipality: municipality.trim() || undefined }),
    });
    if (res.ok) { setEditingMeta(false); onChanged?.(); }
  }
```
> O `CanalPanel` recebe `status`/`onChanged` por props (já existem). Os valores atuais de assunto/cidade vêm do objeto da conversa — passar via novas props opcionais `subject`/`municipality` do `canal/page.tsx`, ou buscar no load. Implementador: adicionar props `subject?: string|null; municipality?: string|null` ao `Props` e inicializar os estados com elas num `useEffect`.

- [ ] **Step 4:** `pnpm --filter @crmwhats/web build`.
- [ ] **Step 5:** commit `feat(web): CanalPanel — assumir, assunto/cidade editáveis, pílulas de sistema`.

---

### Task 8: Lista Canal + Kanban — metadados no card + Assumir

**Files:** `apps/web/src/app/(app)/canal/page.tsx`, `apps/web/src/app/(app)/kanban/page.tsx`. LER ambos.

- [ ] **Step 1:** Garantir que a query das conversas do Canal selecione `subject, municipality, assumed_by` (se usar `select('*')` já vem; se lista campos, adicionar). Passar `subject`/`municipality`/`status` ao `CanalPanel` como props.
- [ ] **Step 2:** No card de cada conversa (lista do Canal e card do Kanban), abaixo do nome, exibir uma linha de metadados quando houver: setor (nome), `📍 cidade`, `🏷️ assunto`, além do badge de status já existente. Usar os nomes de setor já disponíveis (a lista de setores costuma ser carregada; se não, exibir só cidade/assunto + status).
- [ ] **Step 3:** No Kanban, nos cards da coluna "Aguardando" (`status open`), adicionar um botão "✋ Assumir" que chama `POST /api/canal/conversations/:id/assume` e recarrega.
- [ ] **Step 4:** `pnpm --filter @crmwhats/web build`.
- [ ] **Step 5:** commit `feat(web): metadados (setor/cidade/assunto) e Assumir no Canal/Kanban`.

---

### Task 9: Verificação, build e deploy (controlador)

- [ ] **Step 1:** `cd apps/api && npx jest` (verde) + `pnpm --filter @crmwhats/api build`.
- [ ] **Step 2:** `pnpm --filter @crmwhats/web build` (compila/lint/typecheck; EPERM symlink ok).
- [ ] **Step 3:** push + deploy API (`pp6qewlm9usx4rqroaxzi042`) e WEB (`y664pro58rjywtieei0no3ua`) via Coolify.
- [ ] **Step 4:** Confirmar rollout (rota nova `POST /api/canal/conversations/x/assume` sem token → 401, antes 404).
- [ ] **Step 5:** Atualizar handoff.

---

## Self-Review
- **Cobertura do spec:** dados (T1,T2) · delegar→aguardando + transfer (T3) · assume (T3,T4,T7,T8) · share→ativa (T5) · mensagens de sistema interno+cidadão (T3 + render T7) · card metadados + assunto/cidade editável (T7,T8) · sino (T6). ✓
- **Placeholders:** backend com código completo; frontend com snippets + instruções de leitura para arquivos grandes (implementador lê e adapta). ✓
- **Consistência:** `assume(id,userId)`, `setMeta(id,{subject,municipality})`, `delegate(id,sectorId,assignedTo)` batem entre service/controller; `is_system` consistente em types/DB/render; endpoints `:id/assume` e `:id/meta` batem com os fetch do front. ✓
