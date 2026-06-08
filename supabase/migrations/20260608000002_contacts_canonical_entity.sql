-- ========== Contato Único: entidade canônica por número normalizado ==========

-- 1. Normalização BR: só dígitos; remove '55' inicial quando há código país.
create or replace function public.normalize_phone(raw text)
returns text language sql immutable as $$
  select case
    when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3)
    else d
  end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) t;
$$;

-- 2. Tabela canônica.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  phone_key text unique not null,
  display_name text,
  photo_url text,
  municipality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contacts enable row level security;
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (auth.uid() is not null);
drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all using (current_user_role() in ('admin', 'supervisor'))
  with check (current_user_role() in ('admin', 'supervisor'));

-- 3. Colunas contact_id.
alter table public.conversations
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.canal_conversations
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;
alter table public.contact_category_assignments
  add column if not exists contact_id uuid references public.contacts(id) on delete cascade;
alter table public.contact_photos
  add column if not exists contact_id uuid references public.contacts(id) on delete cascade;

-- 4. Resolve/cria o contato por número (SECURITY DEFINER: ignora RLS de contacts).
create or replace function public.resolve_contact(p_number text, p_name text, p_municipality text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k text; cid uuid;
begin
  k := normalize_phone(p_number);
  if k is null or k = '' then return null; end if;
  insert into contacts (phone_key, display_name, municipality)
    values (k, nullif(p_name, ''), nullif(p_municipality, ''))
  on conflict (phone_key) do update
    set display_name = coalesce(contacts.display_name, excluded.display_name),
        municipality = coalesce(contacts.municipality, excluded.municipality),
        updated_at = now()
  returning id into cid;
  return cid;
end$$;

-- 5. Triggers: setam contact_id em insert/update do número.
create or replace function public.tg_conversations_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.contact_id := resolve_contact(new.contact_number, new.contact_name, new.municipality);
  return new;
end$$;

create or replace function public.tg_canal_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.contact_id := resolve_contact(new.wa_contact_number, new.wa_contact_name, new.municipality);
  return new;
end$$;

create or replace function public.tg_byname_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.contact_id := resolve_contact(new.contact_number, null, null);
  return new;
end$$;

drop trigger if exists conversations_set_contact on public.conversations;
create trigger conversations_set_contact before insert or update of contact_number
  on public.conversations for each row execute function tg_conversations_contact();

drop trigger if exists canal_set_contact on public.canal_conversations;
create trigger canal_set_contact before insert or update of wa_contact_number
  on public.canal_conversations for each row execute function tg_canal_contact();

drop trigger if exists cca_set_contact on public.contact_category_assignments;
create trigger cca_set_contact before insert or update of contact_number
  on public.contact_category_assignments for each row execute function tg_byname_contact();

drop trigger if exists cphoto_set_contact on public.contact_photos;
create trigger cphoto_set_contact before insert or update of contact_number
  on public.contact_photos for each row execute function tg_byname_contact();

-- 6. Backfill.
insert into contacts (phone_key, display_name, municipality)
select k,
       (array_agg(nm order by coalesce(length(nm),0) desc))[1],
       (array_agg(mu order by coalesce(length(mu),0) desc))[1]
from (
  select normalize_phone(contact_number) k, contact_name nm, municipality mu
    from conversations where normalize_phone(contact_number) <> ''
  union all
  select normalize_phone(wa_contact_number) k, wa_contact_name nm, municipality mu
    from canal_conversations where normalize_phone(wa_contact_number) <> ''
) s
group by k
on conflict (phone_key) do nothing;

update conversations c set contact_id = ct.id
  from contacts ct where ct.phone_key = normalize_phone(c.contact_number) and c.contact_id is null;
update canal_conversations cc set contact_id = ct.id
  from contacts ct where ct.phone_key = normalize_phone(cc.wa_contact_number) and cc.contact_id is null;
update contact_category_assignments a set contact_id = ct.id
  from contacts ct where ct.phone_key = normalize_phone(a.contact_number) and a.contact_id is null;
update contact_photos p set contact_id = ct.id
  from contacts ct where ct.phone_key = normalize_phone(p.contact_number) and p.contact_id is null;

update contacts ct set photo_url = p.photo_url
  from contact_photos p
  where normalize_phone(p.contact_number) = ct.phone_key and ct.photo_url is null;
