# Gestão de usuários — exclusão (admin) + política de visibilidade (RLS) — Design

**Data:** 2026-06-03
**Projeto:** CRMWhats AMMOC
**Status:** aprovado para planejamento

## Objetivo

1. Permitir que o **administrador exclua um usuário** pela tela `/equipe`, preservando todo
   o histórico (institucional e pessoal) com o autor anonimizado.
2. Garantir que a **visibilidade do "Meu Painel"** (Conversas, Recebidos, Kanban,
   Atendimentos) siga a política regulatória de níveis de acesso.

## Política de visibilidade (matriz)

| Nível | Vê |
|---|---|
| **Admin** | tudo |
| **Supervisor** | tudo (co-admin de visibilidade — decisão do produto; mantido) |
| **Chefe de setor** (`sector_members.lead = true`, via `leads_sector(sid)`) | tudo do(s) seu(s) setor(es) **ou** as próprias/atribuídas |
| **Funcionário** | só as **próprias** (Conversas: `owner_user_id`) / **atribuídas** (Canal: `assigned_to`); "iniciada/respondida" no Canal coberta por auto-atribuição |

## Parte A — Excluir usuário

### Migração (preservar histórico)
Tornar nuláveis (quando preciso) e mudar as FKs que referenciam `public.users(id)` para
`ON DELETE SET NULL`, de modo que as linhas históricas sobrevivam com o autor nulo:

- `attendances.assigned_to` — hoje **NOT NULL** + `NO ACTION` → tornar **nullable** + `SET NULL`.
- `attendance_transfers.from_user_id` / `to_user_id` — **NOT NULL** + `NO ACTION` → **nullable** + `SET NULL`.
- `canal_messages.sent_by` — nullable + `NO ACTION` → `SET NULL`.
- `conversations.shared_by` — nullable + `NO ACTION` → `SET NULL`.
- `conversations.owner_user_id` — hoje **NOT NULL** + `CASCADE` → tornar **nullable** + `SET NULL`
  (preserva as conversas pessoais e suas mensagens; ficam com owner nulo, visíveis só para
  quem vê tudo — admin/supervisor).
- Já `SET NULL` (sem mudança): `conversations.assigned_to`, `conversations.delegated_by`,
  `canal_conversations.assigned_to`, `canal_conversations.closed_by`.

**Removido junto com o usuário (cascata mantida):** `notifications.user_id` (CASCADE) e
`sector_members.user_id` (CASCADE) — alertas pessoais e vínculos de setor, não são histórico.

> Observação: a unique `(owner_user_id, contact_number)` em `conversations` continua válida —
> no Postgres múltiplos NULL são distintos no índice único; e a exclusão apenas faz UPDATE
> de linhas já existentes (não cria duplicatas).

### Backend
Novo endpoint **`DELETE /api/users/:id`** em `UsersController` (já sob `AuthGuard`).
`UsersService.deleteUser(callerId, targetId)`:
1. Confirma que o **chamador é admin** (lê `users.role` do caller via service-role); senão `ForbiddenException`.
2. Bloqueia **auto-exclusão** (`targetId === callerId`) → `BadRequestException`.
3. Bloqueia excluir o **último admin** (conta admins; se target é admin e total de admins ≤ 1 → erro).
4. Best-effort: se o alvo tiver `evolution_instance_id`, chama `EvolutionService.deleteInstance(id)` (try/catch, log).
5. Deleta `public.users` do alvo (dispara as cascatas/SET NULL).
6. `supabaseAdmin` (service-role): `auth.admin.deleteUser(targetId)` — remove do `auth.users`
   (não há FK auth→public, por isso as duas exclusões são explícitas).

`UsersModule` passa a prover `EvolutionService` e `SupabaseAdminService` (este já existe no `AuthModule`).
O client service-role (`SUPABASE_CLIENT`) é usado para as exclusões no schema public.

### Frontend (`/equipe`)
No `UserCard`, quando `canEdit` (admin) e `user.id !== currentUser.id`: botão **"Excluir"**
(vermelho, discreto) que abre confirmação (`confirm()` com o nome) e chama
`DELETE /api/users/:id` com o token. Em sucesso, remove o card da lista; em erro, mostra a mensagem da API.

## Parte B — Política de visibilidade (RLS + atribuição)

### B1 — Corrigir `messages_select` (gap real)
Hoje: `EXISTS(conversations c WHERE c.id = messages.conversation_id AND (c.owner_user_id = auth.uid() OR role IN (supervisor,admin)))`.
Falta o chefe de setor — ele vê a conversa (`conversations_select` tem `leads_sector`) mas
**não** as mensagens. Nova policy (alinhada com `conversations_select`):

```sql
drop policy messages_select on public.messages;
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

As demais policies (`conversations_select`, `attendances_select`, `canal_conv_read`,
`canal_msg_read`) já implementam a matriz corretamente — **sem mudança**.

### B2 — Auto-atribuição no Canal ("iniciada/respondida")
Em `CanalConversationService.reply()` e `sendMediaMessage()`: ao enviar, se a conversa
estiver **sem dono** (`assigned_to IS NULL`), setar `assigned_to = userId` no mesmo
`update` que já roda (junto de `last_message_at`/`status`). Não rouba atribuição existente.
Assim a conversa que o funcionário respondeu passa a ser visível por ele (RLS `assigned_to = auth.uid()`).

### B3 — Supervisor
Mantido vendo tudo (`current_user_role() = any(admin, supervisor)`). Nenhuma policy alterada
por causa disso.

## Testes

- **RLS (SQL, via `set local request.jwt.claims`):** para um funcionário, um chefe de setor
  e um admin/supervisor, verificar a contagem de linhas visíveis em `conversations`,
  `messages`, `canal_conversations`, `attendances` — confere a matriz (ex.: chefe de setor
  passa a ver mensagens do setor após B1; funcionário não vê de outros).
- **Auto-atribuição:** unit de `reply()` — `assigned_to` nulo → vira `userId`; `assigned_to`
  já setado para outro → não muda.
- **Exclusão:** unit de `deleteUser` — caller não-admin → Forbidden; auto-exclusão → erro;
  último admin → erro; caminho feliz chama `auth.admin.deleteUser` e remove `public.users`.
- **Verificação ao vivo:** excluir um usuário de teste pela `/equipe`; confirmar que sumiu de
  `auth.users` e `public.users`, que um atendimento dele ainda existe com `assigned_to` nulo,
  e que as conversas pessoais dele permanecem (owner nulo) visíveis ao admin.

## Riscos / notas
- Tornar `attendances.assigned_to` e `attendance_transfers.*` nuláveis afrouxa uma invariante;
  aceitável pois só ocorre após exclusão de usuário (registro histórico anonimizado).
- A exclusão é destrutiva e irreversível — confirmação no front + bloqueios (self, último admin) no back.
- `messages_select` é trocada por uma versão mais permissiva (adiciona chefe de setor); não
  expõe nada além do que `conversations_select` já permite ver da conversa.
