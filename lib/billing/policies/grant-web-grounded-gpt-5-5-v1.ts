import { AI_OPERATIONS } from "../../ai/operation-registry.ts";
import { AiPricePolicySchema, type AiPricePolicy, type UsageRange } from "../domain/price-catalog.ts";

export const GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION = "grant-web-gpt-5.5-cost-v1" as const;
export const GRANT_WEB_GPT_5_5_MODEL_ID = "gpt-5.5" as const;
export const GRANT_WEB_USER_CHARGE_CAP_POINTS = 50 as const;

const EFFECTIVE_FROM = "2026-09-11T00:00:00.000Z";
const TOKEN_RATES = Object.freeze({
  inputMicroUsdPerMillion: 5_000_000,
  cachedInputMicroUsdPerMillion: 500_000,
  outputMicroUsdPerMillion: 30_000_000,
});
const POLICY_BASE = Object.freeze({
  provider: "openai",
  modelId: GRANT_WEB_GPT_5_5_MODEL_ID,
  tokenRates: TOKEN_RATES,
  cnyMicrosPerUsd: 7_200_000,
  markupBasisPoints: 0,
  rounding: "ceil_to_whole_point" as const,
  effectiveFrom: EFFECTIVE_FROM,
  effectiveUntil: null,
});

export const GRANT_WEB_GPT_5_5_PRICE_POLICIES: readonly AiPricePolicy[] = Object.freeze([
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:next-step-decision`,
    operation: AI_OPERATIONS.grant.webNextStepDecide, unitRates: [],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:query-rewrite`,
    operation: AI_OPERATIONS.grant.webQueryRewrite, unitRates: [],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:search`,
    operation: AI_OPERATIONS.grant.webSearchQuery,
    unitRates: [{ usageKind: "tool_call", discriminator: "openai_web_search", microUsdPerUnit: 10_000, unitSize: 1 }],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:assessment`,
    operation: AI_OPERATIONS.grant.webSourceAssess, unitRates: [],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:gap-comparison`,
    operation: AI_OPERATIONS.grant.webGapCompare, unitRates: [],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:answer`,
    operation: AI_OPERATIONS.grant.webAnswerSynthesize, unitRates: [],
  }),
  AiPricePolicySchema.parse({ ...POLICY_BASE,
    policyVersion: `${GRANT_WEB_GPT_5_5_PRICE_CATALOG_VERSION}:existing-results-delivery`,
    operation: AI_OPERATIONS.grant.webExistingResultsDeliver, unitRates: [],
  }),
]);

const tokens = (inputTokens: number, outputTokens: number) => [{
  kind: "tokens" as const, inputTokens, cachedInputTokens: 0, outputTokens, reasoningTokens: 0,
}];

// `maximum` is the maximum user-billable usage, not a claim that the provider
// cannot consume more. PointBillingService records overage as platform-absorbed.
export const GRANT_WEB_GPT_5_5_USAGE_RANGES: Readonly<Record<string, UsageRange>> = Object.freeze({
  next_step_decision: Object.freeze({ low: tokens(800, 80), high: tokens(2_000, 160), maximum: tokens(4_000, 300) }),
  query_rewrite: Object.freeze({ low: tokens(300, 50), high: tokens(600, 100), maximum: tokens(1_000, 160) }),
  search_query: Object.freeze({
    low: [{ kind: "tool_call" as const, tool: "openai_web_search", count: 1 }, ...tokens(300, 30)],
    high: [{ kind: "tool_call" as const, tool: "openai_web_search", count: 1 }, ...tokens(600, 60)],
    maximum: [{ kind: "tool_call" as const, tool: "openai_web_search", count: 1 }, ...tokens(1_000, 150)],
  }),
  source_assessment: Object.freeze({ low: tokens(500, 50), high: tokens(900, 100), maximum: tokens(1_500, 170) }),
  gap_comparison: Object.freeze({ low: tokens(2_000, 300), high: tokens(8_000, 1_000), maximum: tokens(16_000, 2_000) }),
  grounded_answer: Object.freeze({ low: tokens(700, 120), high: tokens(1_200, 250), maximum: tokens(2_000, 410) }),
  existing_results_delivery: Object.freeze({ low: tokens(2_000, 300), high: tokens(8_000, 800), maximum: tokens(16_000, 1_600) }),
});
