-- CRMWhats — Fix RLS policies and SECURITY DEFINER search_path
-- Addresses: search-path injection vulnerability, FOR ALL INSERT bug, missing indexes

-- ── Fix SECURITY DEFINER functions: add SET search_path = '' ─────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
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

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- ── Fix config-table policies: replace FOR ALL with explicit per-op policies ──

-- bot_config
DROP POLICY IF EXISTS "bot_config_admin" ON public.bot_config;

CREATE POLICY "bot_config_select" ON public.bot_config FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "bot_config_insert" ON public.bot_config FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "bot_config_update" ON public.bot_config FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "bot_config_delete" ON public.bot_config FOR DELETE
  USING (public.current_user_role() = 'admin');

-- github_sync_config
DROP POLICY IF EXISTS "github_sync_admin" ON public.github_sync_config;

CREATE POLICY "github_sync_select" ON public.github_sync_config FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "github_sync_insert" ON public.github_sync_config FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "github_sync_update" ON public.github_sync_config FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "github_sync_delete" ON public.github_sync_config FOR DELETE
  USING (public.current_user_role() = 'admin');

-- agent_config
DROP POLICY IF EXISTS "agent_config_admin" ON public.agent_config;

CREATE POLICY "agent_config_select" ON public.agent_config FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "agent_config_insert" ON public.agent_config FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "agent_config_update" ON public.agent_config FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "agent_config_delete" ON public.agent_config FOR DELETE
  USING (public.current_user_role() = 'admin');

-- rag_sources
DROP POLICY IF EXISTS "rag_sources_admin" ON public.rag_sources;

CREATE POLICY "rag_sources_select" ON public.rag_sources FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "rag_sources_insert" ON public.rag_sources FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "rag_sources_update" ON public.rag_sources FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "rag_sources_delete" ON public.rag_sources FOR DELETE
  USING (public.current_user_role() = 'admin');

-- integrations
DROP POLICY IF EXISTS "integrations_admin" ON public.integrations;

CREATE POLICY "integrations_select" ON public.integrations FOR SELECT
  USING (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "integrations_insert" ON public.integrations FOR INSERT
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "integrations_update" ON public.integrations FOR UPDATE
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY "integrations_delete" ON public.integrations FOR DELETE
  USING (public.current_user_role() = 'admin');

-- ── Add write policies for context_files (backend/admin only) ────────────────

CREATE POLICY "context_files_insert" ON public.context_files FOR INSERT
  WITH CHECK (public.current_user_role() IN ('supervisor', 'admin'));

CREATE POLICY "context_files_update" ON public.context_files FOR UPDATE
  USING (public.current_user_role() IN ('supervisor', 'admin'))
  WITH CHECK (public.current_user_role() IN ('supervisor', 'admin'));

-- ── Add DELETE policy for conversations ──────────────────────────────────────

CREATE POLICY "conversations_delete" ON public.conversations FOR DELETE
  USING (owner_user_id = auth.uid() OR public.current_user_role() = 'admin');

-- ── Add missing indexes ───────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_transfers_attendance
  ON public.attendance_transfers(attendance_id);

CREATE INDEX IF NOT EXISTS idx_context_files_conversation
  ON public.context_files(conversation_id);

-- ── Add UNIQUE constraint on users.email ─────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_email_unique' AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_email_unique UNIQUE (email);
  END IF;
END;
$$;

-- ── Single-row enforcement for config tables ──────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS bot_config_single_row
  ON public.bot_config ((true));

CREATE UNIQUE INDEX IF NOT EXISTS github_sync_single_row
  ON public.github_sync_config ((true));

CREATE UNIQUE INDEX IF NOT EXISTS agent_config_single_row
  ON public.agent_config ((true));
