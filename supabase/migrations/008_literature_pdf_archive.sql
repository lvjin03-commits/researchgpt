-- Literature PDF archive storage and extracted full text
-- Run after 007_literature_folder_nesting.sql

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('literature-pdfs', 'literature-pdfs', false, 104857600)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit;

ALTER TABLE public.literature_papers
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS pdf_file_name TEXT,
  ADD COLUMN IF NOT EXISTS pdf_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS pdf_download_status TEXT NOT NULL DEFAULT 'not_attempted'
    CHECK (pdf_download_status IN ('not_attempted', 'stored', 'failed', 'unavailable')),
  ADD COLUMN IF NOT EXISTS pdf_download_error TEXT,
  ADD COLUMN IF NOT EXISTS full_text TEXT,
  ADD COLUMN IF NOT EXISTS full_text_extracted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS literature_papers_pdf_status_idx
  ON public.literature_papers (user_id, pdf_download_status);

DROP POLICY IF EXISTS "Users upload own literature PDFs" ON storage.objects;
CREATE POLICY "Users upload own literature PDFs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'literature-pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users read own literature PDFs" ON storage.objects;
CREATE POLICY "Users read own literature PDFs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'literature-pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users update own literature PDFs" ON storage.objects;
CREATE POLICY "Users update own literature PDFs"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'literature-pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'literature-pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own literature PDFs" ON storage.objects;
CREATE POLICY "Users delete own literature PDFs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'literature-pdfs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
