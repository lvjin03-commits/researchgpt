-- ResearchGPT literature paper workspace fields
-- Run in the Supabase SQL Editor after 005_literature_folders.sql

ALTER TABLE public.literature_papers
  ADD COLUMN IF NOT EXISTS personal_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS workspace_analysis JSONB;
