-- ResearchGPT literature custom categories
-- Run in the Supabase SQL Editor after 004_literature_source_taxonomy.sql

CREATE TABLE IF NOT EXISTS public.literature_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS public.literature_paper_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  paper_id UUID NOT NULL REFERENCES public.literature_papers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.literature_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, paper_id, category_id)
);

CREATE INDEX IF NOT EXISTS literature_categories_user_id_idx
  ON public.literature_categories (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS literature_paper_categories_user_paper_idx
  ON public.literature_paper_categories (user_id, paper_id);

CREATE INDEX IF NOT EXISTS literature_paper_categories_user_category_idx
  ON public.literature_paper_categories (user_id, category_id);

ALTER TABLE public.literature_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.literature_paper_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own literature categories" ON public.literature_categories;
CREATE POLICY "Users select own literature categories"
  ON public.literature_categories
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature categories" ON public.literature_categories;
CREATE POLICY "Users insert own literature categories"
  ON public.literature_categories
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature categories" ON public.literature_categories;
CREATE POLICY "Users update own literature categories"
  ON public.literature_categories
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own literature categories" ON public.literature_categories;
CREATE POLICY "Users delete own literature categories"
  ON public.literature_categories
  FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own literature paper categories" ON public.literature_paper_categories;
CREATE POLICY "Users select own literature paper categories"
  ON public.literature_paper_categories
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature paper categories" ON public.literature_paper_categories;
CREATE POLICY "Users insert own literature paper categories"
  ON public.literature_paper_categories
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature paper categories" ON public.literature_paper_categories;
CREATE POLICY "Users update own literature paper categories"
  ON public.literature_paper_categories
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own literature paper categories" ON public.literature_paper_categories;
CREATE POLICY "Users delete own literature paper categories"
  ON public.literature_paper_categories
  FOR DELETE
  USING (auth.uid() = user_id);
