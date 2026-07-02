-- ResearchGPT literature source taxonomy fields
-- Run in the Supabase SQL Editor after 003_literature_tracker.sql

ALTER TABLE public.literature_settings
  ADD COLUMN IF NOT EXISTS discipline TEXT NOT NULL DEFAULT 'ai';

ALTER TABLE public.literature_settings
  ADD COLUMN IF NOT EXISTS selected_sources JSONB NOT NULL DEFAULT '["arxiv"]'::jsonb;

UPDATE public.literature_settings
SET discipline = 'ai'
WHERE discipline IS NULL OR discipline = '';

UPDATE public.literature_settings
SET selected_sources = '["arxiv"]'::jsonb
WHERE selected_sources IS NULL
   OR selected_sources = '[]'::jsonb
   OR jsonb_typeof(selected_sources) <> 'array';

UPDATE public.literature_settings
SET selected_sources = '["arxiv"]'::jsonb
WHERE source = 'arxiv'
  AND (selected_sources IS NULL OR selected_sources = '[]'::jsonb);
