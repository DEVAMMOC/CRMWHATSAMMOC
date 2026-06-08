-- Comunicação Interna: chat 1:1 entre usuários, persistido, RLS por participante.
create table if not exists public.internal_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.users(id) on delete set null,
  recipient_id uuid references public.users(id) on delete set null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists internal_messages_recipient_unread_idx
  on public.internal_messages (recipient_id, read_at);
create index if not exists internal_messages_thread_idx
  on public.internal_messages (sender_id, recipient_id, created_at);

alter table public.internal_messages enable row level security;

drop policy if exists internal_messages_select on public.internal_messages;
create policy internal_messages_select on public.internal_messages
  for select using (sender_id = auth.uid() or recipient_id = auth.uid());

drop policy if exists internal_messages_insert on public.internal_messages;
create policy internal_messages_insert on public.internal_messages
  for insert with check (sender_id = auth.uid());

drop policy if exists internal_messages_update_read on public.internal_messages;
create policy internal_messages_update_read on public.internal_messages
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
