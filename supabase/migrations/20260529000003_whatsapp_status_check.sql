-- supabase/migrations/20260529000003_whatsapp_status_check.sql
-- Add CHECK constraint to enforce allowed values for whatsapp_status

ALTER TABLE public.users
  ADD CONSTRAINT users_whatsapp_status_check
  CHECK (whatsapp_status IN ('disconnected', 'connecting', 'connected'));
