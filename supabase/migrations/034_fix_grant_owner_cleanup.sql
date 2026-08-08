-- Grant revisions and audit events are already owned transitively by a grant
-- document. Keep their direct auth-user references consistent with the
-- existing owner ON DELETE CASCADE lifecycle.

ALTER TABLE public.grant_document_revisions
  DROP CONSTRAINT IF EXISTS grant_document_revisions_created_by_fkey;
ALTER TABLE public.grant_document_revisions
  ADD CONSTRAINT grant_document_revisions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.grant_audit_events
  DROP CONSTRAINT IF EXISTS grant_audit_events_actor_id_fkey;
ALTER TABLE public.grant_audit_events
  ADD CONSTRAINT grant_audit_events_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
