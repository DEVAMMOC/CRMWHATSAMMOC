-- Prevent duplicate conversation rows for the same contact per owner.
-- This eliminates the race condition in the webhook find-or-create path,
-- allowing the webhook service to use a single atomic upsert.
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_owner_contact_unique
  UNIQUE (owner_user_id, contact_number);
