-- Complete the append-only price catalog and model-call constraints for the
-- user-authorized resumable Grant web-answer workflow introduced in 070.

SELECT public.put_ai_price_policy($policy$
{"policyVersion":"grant-web-gpt-5.5-cost-v1:next-step-decision","operation":"grant.web_next_step.decide","provider":"openai","modelId":"gpt-5.5","tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},"unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,"rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null}
$policy$::jsonb);

SELECT public.put_ai_price_policy($policy$
{"policyVersion":"grant-web-gpt-5.5-cost-v1:gap-comparison","operation":"grant.web_gap.compare","provider":"openai","modelId":"gpt-5.5","tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},"unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,"rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null}
$policy$::jsonb);

SELECT public.put_ai_price_policy($policy$
{"policyVersion":"grant-web-gpt-5.5-cost-v1:existing-results-delivery","operation":"grant.web_existing_results.deliver","provider":"openai","modelId":"gpt-5.5","tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},"unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,"rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null}
$policy$::jsonb);

ALTER TABLE public.grant_model_calls
  DROP CONSTRAINT IF EXISTS grant_model_calls_operation_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_policy_version_check;
ALTER TABLE public.grant_model_calls
  ADD CONSTRAINT grant_model_calls_operation_check CHECK(operation IN (
    'grant.edit_session.turn','grant.assistant.chat','grant.edit_candidate.explain',
    'grant.web_query.rewrite','grant.web_search.query','grant.web_source.assess',
    'grant.web_gap.compare','grant.web_answer.synthesize',
    'grant.web_next_step.decide','grant.web_existing_results.deliver')),
  ADD CONSTRAINT grant_model_calls_policy_version_check CHECK(
    (operation='grant.edit_session.turn' AND policy_version='grant-edit-session-turn-v1') OR
    (operation='grant.assistant.chat' AND policy_version='grant-assistant-chat-v1') OR
    (operation='grant.edit_candidate.explain' AND policy_version='grant-edit-candidate-explain-v1') OR
    (operation='grant.web_query.rewrite' AND policy_version='grant-web-query-rewrite-v1') OR
    (operation='grant.web_search.query' AND policy_version='grant-web-search-query-v1') OR
    (operation='grant.web_source.assess' AND policy_version='grant-web-source-assess-v1') OR
    (operation='grant.web_gap.compare' AND policy_version='grant-web-gap-compare-v1') OR
    (operation='grant.web_answer.synthesize' AND policy_version='grant-web-answer-synthesize-v1') OR
    (operation='grant.web_next_step.decide' AND policy_version='grant-web-next-step-decide-v1') OR
    (operation='grant.web_existing_results.deliver' AND policy_version='grant-web-existing-results-deliver-v1'));
