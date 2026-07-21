-- ResearchGPT cross-device research workspace sync
-- Run after 001_chat_history.sql.

CREATE TABLE IF NOT EXISTS public.research_workspaces (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  projects JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_project_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS research_workspaces_set_updated_at
ON public.research_workspaces;

CREATE TRIGGER research_workspaces_set_updated_at
BEFORE UPDATE ON public.research_workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.research_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own research workspace"
ON public.research_workspaces;
CREATE POLICY "Users select own research workspace"
  ON public.research_workspaces
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own research workspace"
ON public.research_workspaces;
CREATE POLICY "Users insert own research workspace"
  ON public.research_workspaces
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own research workspace"
ON public.research_workspaces;
CREATE POLICY "Users update own research workspace"
  ON public.research_workspaces
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own research workspace"
ON public.research_workspaces;
CREATE POLICY "Users delete own research workspace"
  ON public.research_workspaces
  FOR DELETE
  USING (auth.uid() = user_id);
