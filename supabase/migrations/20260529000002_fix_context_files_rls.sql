-- supabase/migrations/20260529000002_fix_context_files_rls.sql
-- Drop the old supervisor-only SELECT policy that was superseded by context_files_owner_select

DROP POLICY IF EXISTS "context_files_select" ON public.context_files;
