-- CRMWhats — Schema inicial
-- Projeto: xfqphbdurynuwvrnxpvj

-- ── Extensões ────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tipos enum ───────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('funcionario', 'supervisor', 'admin');
CREATE TYPE conversation_status AS ENUM ('nao_salva', 'pendente', 'ativa', 'encerrada');
CREATE TYPE conversation_source AS ENUM ('pessoal', 'bot');
CREATE TYPE attendance_status AS ENUM ('aberto', 'em_andamento', 'transferido', 'encerrado');
CREATE TYPE message_direction AS ENUM ('in', 'out');
CREATE TYPE message_type AS ENUM ('text', 'image', 'document', 'audio', 'video');
CREATE TYPE context_file_type AS ENUM ('json', 'md', 'index');
CREATE TYPE sync_status AS ENUM ('success', 'error', 'pending');
CREATE TYPE bot_provider AS ENUM ('evolution_go', 'meta_cloud', 'twilio');
CREATE TYPE integration_type AS ENUM ('supabase', 'drive', 'projex', 'enggov', 'github', 'custom');
CREATE TYPE integration_status AS ENUM ('connected', 'disconnected', 'error');
CREATE TYPE rag_source_type AS ENUM ('github', 'supabase', 'drive', 'projex', 'enggov', 'webhook');

-- ── Tabela users ─────────────────────────────────────────
CREATE TABLE public.users (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       text NOT NULL,
  name        text NOT NULL,
  role        user_role NOT NULL DEFAULT 'funcionario',
  whatsapp_number          text,
  evolution_instance_id    text,
  evolution_instance_token text,
  is_online   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Tabela conversations ──────────────────────────────────
CREATE TABLE public.conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contact_number   text NOT NULL,
  contact_name     text NOT NULL DEFAULT '',
  status           conversation_status NOT NULL DEFAULT 'nao_salva',
  source           conversation_source NOT NULL DEFAULT 'pessoal',
  municipality     text,
  trigger_keywords text[] NOT NULL DEFAULT '{}',
  last_message_at  timestamptz,
  last_synced_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_owner ON public.conversations(owner_user_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_conversations_last_msg ON public.conversations(last_message_at DESC);

-- ── Tabela messages ───────────────────────────────────────
CREATE TABLE public.messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction             message_direction NOT NULL,
  content               text NOT NULL DEFAULT '',
  message_type          message_type NOT NULL DEFAULT 'text',
  media_url             text,
  evolution_message_id  text UNIQUE,
  sent_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, sent_at);

-- ── Tabela attendances ────────────────────────────────────
CREATE TABLE public.attendances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES public.users(id),
  status          attendance_status NOT NULL DEFAULT 'aberto',
  municipality    text,
  summary         text,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendances_assigned ON public.attendances(assigned_to);
CREATE INDEX idx_attendances_status ON public.attendances(status);

-- ── Tabela attendance_transfers ───────────────────────────
CREATE TABLE public.attendance_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id   uuid NOT NULL REFERENCES public.attendances(id) ON DELETE CASCADE,
  from_user_id    uuid NOT NULL REFERENCES public.users(id),
  to_user_id      uuid NOT NULL REFERENCES public.users(id),
  note            text,
  transferred_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela context_files ──────────────────────────────────
CREATE TABLE public.context_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  file_type         context_file_type NOT NULL,
  github_path       text,
  github_commit_sha text,
  message_count     integer NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  status            sync_status NOT NULL DEFAULT 'pending',
  error_message     text
);

-- ── Tabela bot_config (single row) ───────────────────────
CREATE TABLE public.bot_config (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active                boolean NOT NULL DEFAULT false,
  instance_id              text,
  instance_token           text,
  provider                 bot_provider NOT NULL DEFAULT 'evolution_go',
  welcome_message          text NOT NULL DEFAULT 'Olá! Você entrou em contato com a AMMOC. Em breve retornaremos.',
  delegate_by_municipality boolean NOT NULL DEFAULT true,
  auto_reply_after_hours   boolean NOT NULL DEFAULT true,
  notify_on_delegation     boolean NOT NULL DEFAULT true,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela github_sync_config (single row) ───────────────
CREATE TABLE public.github_sync_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active          boolean NOT NULL DEFAULT false,
  repo               text NOT NULL DEFAULT '',
  branch             text NOT NULL DEFAULT 'main',
  output_dir         text NOT NULL DEFAULT 'context/',
  pat_token          text NOT NULL DEFAULT '',
  generate_json      boolean NOT NULL DEFAULT true,
  generate_md        boolean NOT NULL DEFAULT true,
  generate_index     boolean NOT NULL DEFAULT true,
  only_closed        boolean NOT NULL DEFAULT false,
  sync_time          time NOT NULL DEFAULT '02:00',
  file_prefix        text NOT NULL DEFAULT 'ammoc-conv-',
  last_sync_at       timestamptz,
  last_sync_status   sync_status,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela agent_config (single row) ─────────────────────
CREATE TABLE public.agent_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_active        boolean NOT NULL DEFAULT false,
  model            text NOT NULL DEFAULT 'gpt-4o',
  api_key          text NOT NULL DEFAULT '',
  system_prompt    text NOT NULL DEFAULT 'Você é o assistente oficial da AMMOC.',
  temperature      numeric(3,2) NOT NULL DEFAULT 0.30,
  suggest_replies  boolean NOT NULL DEFAULT true,
  auto_summarize   boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela rag_sources ────────────────────────────────────
CREATE TABLE public.rag_sources (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         rag_source_type NOT NULL,
  name         text NOT NULL,
  config       jsonb NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Tabela integrations ───────────────────────────────────
CREATE TABLE public.integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type             integration_type NOT NULL,
  name             text NOT NULL,
  config           jsonb NOT NULL DEFAULT '{}',
  status           integration_status NOT NULL DEFAULT 'disconnected',
  last_checked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_files        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_sync_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_sources          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations         ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE POLICY "users_select_own" ON public.users FOR SELECT
  USING (id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "users_update_own" ON public.users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "users_admin_all" ON public.users FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "conversations_select" ON public.conversations FOR SELECT
  USING (owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "conversations_insert_own" ON public.conversations FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "conversations_update_own" ON public.conversations FOR UPDATE
  USING (owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "messages_select" ON public.messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id
    AND (c.owner_user_id = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'))
  ));

CREATE POLICY "messages_insert" ON public.messages FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND c.owner_user_id = auth.uid()
  ));

CREATE POLICY "attendances_select" ON public.attendances FOR SELECT
  USING (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "attendances_insert" ON public.attendances FOR INSERT
  WITH CHECK (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "attendances_update" ON public.attendances FOR UPDATE
  USING (assigned_to = auth.uid() OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "transfers_select" ON public.attendance_transfers FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid()
    OR public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "transfers_insert" ON public.attendance_transfers FOR INSERT
  WITH CHECK (from_user_id = auth.uid() OR public.current_user_role() = 'admin');

CREATE POLICY "context_files_select" ON public.context_files FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "bot_config_admin" ON public.bot_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "github_sync_admin" ON public.github_sync_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "agent_config_admin" ON public.agent_config FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "rag_sources_admin" ON public.rag_sources FOR ALL
  USING (public.current_user_role() = 'admin');

CREATE POLICY "integrations_admin" ON public.integrations FOR ALL
  USING (public.current_user_role() = 'admin');
