-- Diagnostic runs belong to a grant document and must follow the same
-- auth-user lifecycle as canonical grant revisions and audit events.

ALTER TABLE public.grant_diagnostic_runs
  DROP CONSTRAINT IF EXISTS grant_diagnostic_runs_created_by_fkey;
ALTER TABLE public.grant_diagnostic_runs
  ADD CONSTRAINT grant_diagnostic_runs_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
