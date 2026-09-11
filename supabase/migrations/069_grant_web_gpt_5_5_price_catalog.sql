-- Effective-dated, cost-based pricing for the initial gpt-5.5 web-grounded
-- Grant Assistant canary. 1 point = CNY 0.01; USD/CNY = 7.20; markup = 0%.
-- Web search official price at publication: USD 10 / 1,000 calls.

SELECT public.put_ai_price_policy($policy$
{
  "policyVersion":"grant-web-gpt-5.5-cost-v1:query-rewrite",
  "operation":"grant.web_query.rewrite",
  "provider":"openai",
  "modelId":"gpt-5.5",
  "tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},
  "unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,
  "rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null
}
$policy$::jsonb);

SELECT public.put_ai_price_policy($policy$
{
  "policyVersion":"grant-web-gpt-5.5-cost-v1:search",
  "operation":"grant.web_search.query",
  "provider":"openai",
  "modelId":"gpt-5.5",
  "tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},
  "unitRates":[{"usageKind":"tool_call","discriminator":"openai_web_search","microUsdPerUnit":10000,"unitSize":1}],
  "cnyMicrosPerUsd":7200000,"markupBasisPoints":0,"rounding":"ceil_to_whole_point",
  "effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null
}
$policy$::jsonb);

SELECT public.put_ai_price_policy($policy$
{
  "policyVersion":"grant-web-gpt-5.5-cost-v1:assessment",
  "operation":"grant.web_source.assess",
  "provider":"openai",
  "modelId":"gpt-5.5",
  "tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},
  "unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,
  "rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null
}
$policy$::jsonb);

SELECT public.put_ai_price_policy($policy$
{
  "policyVersion":"grant-web-gpt-5.5-cost-v1:answer",
  "operation":"grant.web_answer.synthesize",
  "provider":"openai",
  "modelId":"gpt-5.5",
  "tokenRates":{"inputMicroUsdPerMillion":5000000,"cachedInputMicroUsdPerMillion":500000,"outputMicroUsdPerMillion":30000000},
  "unitRates":[],"cnyMicrosPerUsd":7200000,"markupBasisPoints":0,
  "rounding":"ceil_to_whole_point","effectiveFrom":"2026-09-11T00:00:00.000Z","effectiveUntil":null
}
$policy$::jsonb);
