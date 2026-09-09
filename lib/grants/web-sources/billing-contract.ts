import { z } from "zod";
import { AI_OPERATIONS } from "../../ai/operation-registry.ts";

export const GRANT_WEB_GROUNDED_CHAT_BILLING_VERSION = "grant-web-grounded-chat-billing-v1" as const;

const StageSchema = z.object({
  billingOperationId: z.string().uuid(),
  pricePolicyVersion: z.string().trim().min(1).max(100),
}).strict();

export const GrantWebGroundedChatBillingPlanSchema = z.object({
  contractVersion: z.literal(GRANT_WEB_GROUNDED_CHAT_BILLING_VERSION),
  parentOperation: z.literal(AI_OPERATIONS.grant.assistantChat),
  parentBillingOperationId: z.string().uuid(),
  queryRewrite: StageSchema.extend({
    operation: z.literal(AI_OPERATIONS.grant.webQueryRewrite),
    bundleKey: z.literal("query_rewrite"),
  }).strict(),
  search: StageSchema.extend({
    operation: z.literal(AI_OPERATIONS.grant.webSearchQuery),
    bundleKey: z.literal("search_query"),
  }).strict(),
  assessment: StageSchema.extend({
    operation: z.literal(AI_OPERATIONS.grant.webSourceAssess),
    bundleKey: z.literal("source_assessment"),
  }).strict(),
  answer: StageSchema.extend({
    operation: z.literal(AI_OPERATIONS.grant.webAnswerSynthesize),
    bundleKey: z.literal("grounded_answer"),
  }).strict(),
}).strict().superRefine((plan, context) => {
  const ids = [plan.parentBillingOperationId, plan.queryRewrite.billingOperationId, plan.search.billingOperationId,
    plan.assessment.billingOperationId, plan.answer.billingOperationId];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Parent and stage billing operation IDs must be distinct." });
  }
});

export type GrantWebGroundedChatBillingPlan = z.infer<typeof GrantWebGroundedChatBillingPlanSchema>;

export const GRANT_WEB_NON_BILLABLE_OUTCOMES = Object.freeze({
  egress_blocked: "blocked",
  cache_hit: "succeeded_internal_only",
  no_results: "succeeded_internal_only",
  discarded_assessment: "succeeded_internal_only",
} as const);

export const GRANT_WEB_BILLABLE_USAGE = Object.freeze({
  queryRewrite: Object.freeze({ kind: "tokens" }),
  search: Object.freeze({ kind: "tool_call", tool: "google_custom_search_query" }),
  assessment: Object.freeze({ kind: "tokens" }),
  answer: Object.freeze({ kind: "tokens" }),
} as const);
