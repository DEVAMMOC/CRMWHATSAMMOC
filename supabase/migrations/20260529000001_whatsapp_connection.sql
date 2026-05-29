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

-- 5. RLS: drop old supervisor-only SELECT policy before adding the owner-inclusive one
DROP POLICY IF EXISTS "context_files_select" ON public.context_files;

-- 6. RLS: owner can see their own context files
CREATE POLICY "context_files_owner_select" ON public.context_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id
        AND c.owner_user_id = auth.uid()
    )
    OR public.current_user_role() IN ('supervisor', 'admin')
  );
