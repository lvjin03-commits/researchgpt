-- ResearchGPT literature folder collections
-- Run in the Supabase SQL Editor after 004_literature_source_taxonomy.sql

CREATE TABLE IF NOT EXISTS public.literature_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.literature_folder_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES public.literature_folders(id) ON DELETE CASCADE,
  paper_id UUID NOT NULL REFERENCES public.literature_papers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, folder_id, paper_id)
);

CREATE INDEX IF NOT EXISTS literature_folders_user_id_idx
  ON public.literature_folders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS literature_folder_papers_user_paper_idx
  ON public.literature_folder_papers (user_id, paper_id);

CREATE INDEX IF NOT EXISTS literature_folder_papers_user_folder_idx
  ON public.literature_folder_papers (user_id, folder_id);

ALTER TABLE public.literature_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.literature_folder_papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own literature folders" ON public.literature_folders;
CREATE POLICY "Users select own literature folders"
  ON public.literature_folders
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature folders" ON public.literature_folders;
CREATE POLICY "Users insert own literature folders"
  ON public.literature_folders
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature folders" ON public.literature_folders;
CREATE POLICY "Users update own literature folders"
  ON public.literature_folders
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own literature folders" ON public.literature_folders;
CREATE POLICY "Users delete own literature folders"
  ON public.literature_folders
  FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own literature folder papers" ON public.literature_folder_papers;
CREATE POLICY "Users select own literature folder papers"
  ON public.literature_folder_papers
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature folder papers" ON public.literature_folder_papers;
CREATE POLICY "Users insert own literature folder papers"
  ON public.literature_folder_papers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature folder papers" ON public.literature_folder_papers;
CREATE POLICY "Users update own literature folder papers"
  ON public.literature_folder_papers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own literature folder papers" ON public.literature_folder_papers;
CREATE POLICY "Users delete own literature folder papers"
  ON public.literature_folder_papers
  FOR DELETE
  USING (auth.uid() = user_id);
