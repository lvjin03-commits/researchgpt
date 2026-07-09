-- Figure and table evidence extracted from archived literature PDFs.
-- Run after 008_literature_pdf_archive.sql.

ALTER TABLE public.literature_papers
  ADD COLUMN IF NOT EXISTS figure_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS figure_evidence_extracted_at TIMESTAMPTZ;
