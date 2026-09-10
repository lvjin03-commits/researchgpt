-- Replace the retired Google Custom Search runtime provider with OpenAI web search.
ALTER TABLE public.grant_web_search_egress_audits
  DROP CONSTRAINT IF EXISTS grant_web_search_egress_audits_provider_id_check;

ALTER TABLE public.grant_web_search_egress_audits
  ADD CONSTRAINT grant_web_search_egress_audits_provider_id_check
  CHECK (provider_id IN ('openalex', 'google_custom_search', 'openai_web_search'));

COMMENT ON CONSTRAINT grant_web_search_egress_audits_provider_id_check
  ON public.grant_web_search_egress_audits IS
  'Active general-web runtime uses openai_web_search; google_custom_search is retained for immutable historical audit compatibility.';
