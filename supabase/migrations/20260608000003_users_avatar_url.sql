-- Foto de perfil do usuário (avatar). Armazenada no bucket wa-media em
-- <uid>/avatar-*.<ext>; a URL pública fica aqui.
alter table public.users add column if not exists avatar_url text;
