-- ResearchGPT literature tracker
-- Run in the Supabase SQL Editor after 001_chat_history.sql

CREATE TABLE IF NOT EXISTS public.literature_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  research_direction TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  exclude_keywords TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'arxiv',
  date_range_days INTEGER NOT NULL DEFAULT 7 CHECK (date_range_days > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.literature_papers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  arxiv_id TEXT NOT NULL,
  title TEXT NOT NULL,
  abstract TEXT NOT NULL,
  authors JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  pdf_url TEXT NOT NULL,
  abs_url TEXT NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  relevance_score INTEGER CHECK (relevance_score >= 0 AND relevance_score <= 100),
  priority TEXT CHECK (priority IN ('recommended', 'skim', 'skip')),
  chinese_summary TEXT,
  recommendation_reason TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'skipped', 'read')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, arxiv_id)
);

CREATE INDEX IF NOT EXISTS literature_papers_user_id_relevance_idx
  ON public.literature_papers (user_id, relevance_score DESC NULLS LAST, fetched_at DESC);

ALTER TABLE public.literature_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.literature_papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users select own literature settings" ON public.literature_settings;
CREATE POLICY "Users select own literature settings"
  ON public.literature_settings
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature settings" ON public.literature_settings;
CREATE POLICY "Users insert own literature settings"
  ON public.literature_settings
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature settings" ON public.literature_settings;
CREATE POLICY "Users update own literature settings"
  ON public.literature_settings
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users select own literature papers" ON public.literature_papers;
CREATE POLICY "Users select own literature papers"
  ON public.literature_papers
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own literature papers" ON public.literature_papers;
CREATE POLICY "Users insert own literature papers"
  ON public.literature_papers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own literature papers" ON public.literature_papers;
CREATE POLICY "Users update own literature papers"
  ON public.literature_papers
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own literature papers" ON public.literature_papers;
CREATE POLICY "Users delete own literature papers"
  ON public.literature_papers
  FOR DELETE
  USING (auth.uid() = user_id);
