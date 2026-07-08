-- Nested literature folders with optional description
-- Run after 005_literature_folders.sql

ALTER TABLE public.literature_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.literature_folders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.literature_folders
  DROP CONSTRAINT IF EXISTS literature_folders_user_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS literature_folders_user_parent_name_idx
  ON public.literature_folders (
    user_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

CREATE INDEX IF NOT EXISTS literature_folders_parent_id_idx
  ON public.literature_folders (user_id, parent_id);
