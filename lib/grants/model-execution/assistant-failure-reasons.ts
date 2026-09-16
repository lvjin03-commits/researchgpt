import { z } from "zod";
import type { GrantModelFailureCategory } from "./operation-registry.ts";

/**
 * Rule-level failure attribution for the Grant Assistant.
 *
 * This contract extends the existing stage/category telemetry. It does not own
 * retry policy or user-facing presentation, and it must never contain prompt,
 * document, diagnostic, model-output or stack-trace text.
 */
export const GRANT_ASSISTANT_FAILURE_REASON_CONTRACT_VERSION =
  "grant-assistant-failure-reason-v1" as const;

export const GrantAssistantFailureStageSchema = z.enum([
  "memory_build",
  "semantic_planning",
  "context_admission",
  "original_retrieval",
  "answer_generation",
  "persistence",
]);
export type GrantAssistantFailureStage = z.infer<typeof GrantAssistantFailureStageSchema>;

export const GrantAssistantFailureComponentSchema = z.enum([
  "document_memory",
  "semantic_planner",
  "context_budget",
  "planned_context",
  "hierarchical_review",
  "grounded_answer_validator",
  "model_adapter",
  "model_executor",
  "persistence",
]);
export type GrantAssistantFailureComponent = z.infer<typeof GrantAssistantFailureComponentSchema>;

export const GrantAssistantFailureCategorySchema = z.enum([
  "structured_output_invalid",
  "output_truncated",
  "content_filtered",
  "provider_refusal",
  "provider_rate_limited",
  "provider_transient_error",
  "provider_contract_error",
  "provider_unavailable",
  "planning_capacity_exceeded",
  "answer_capacity_exceeded",
  "internal_contract_error",
]);

export const GRANT_ASSISTANT_FAILURE_REASON_CODES = [
  "memory.snapshot_contract_invalid",
  "memory.stale_revision",
  "memory.context_capacity_exceeded",
  "memory.policy_invalid",
  "memory.unit_output_invalid",
  "memory.model_identity_mismatch",
  "planner.question_missing",
  "planner.memory_contract_invalid",
  "planner.stale_memory",
  "planner.output_contract_invalid",
  "planner.unavailable_target",
  "planner.targeted_original_missing_target",
  "planner.relevant_diagnostic_missing_target",
  "planner.clarification_question_missing",
  "planner.model_identity_mismatch",
  "budget.policy_limit_invalid",
  "budget.current_question_missing",
  "budget.planning_required_context_exceeded",
  "budget.answer_required_context_exceeded",
  "budget.review_unit_required_context_exceeded",
  "budget.review_synthesis_required_context_exceeded",
  "context.stale_plan",
  "context.snapshot_contract_invalid",
  "context.output_contract_invalid",
  "context.stale_memory",
  "context.section_anchor_outside_subtree",
  "context.item_anchor_outside_section",
  "context.target_unavailable",
  "context.diagnostics_unavailable",
  "context.diagnostic_contract_invalid",
  "context.diagnostic_anchor_invalid",
  "review.policy_invalid",
  "review.model_unavailable",
  "review.context_mismatch",
  "review.coverage_incomplete",
  "review.cited_source_unavailable",
  "review.unit_output_invalid",
  "review.synthesis_output_invalid",
  "review.model_identity_mismatch",
  "answer.ungrounded_claims_present",
  "answer.output_contract_invalid",
  "answer.model_identity_mismatch",
  "answer.grounded_bindings_missing",
  "answer.citation_source_invalid",
  "answer.claim_citation_invalid",
  "provider.output_truncated",
  "provider.content_filtered",
  "provider.refusal",
  "provider.rate_limited",
  "provider.transient_error",
  "provider.contract_error",
  "provider.unavailable",
  "executor.unclassified_failure",
  "persistence.attempt_start_failed",
  "persistence.attempt_finish_failed",
] as const;

export const GrantAssistantFailureReasonCodeSchema = z.enum(
  GRANT_ASSISTANT_FAILURE_REASON_CODES,
);
export type GrantAssistantFailureReasonCode = z.infer<typeof GrantAssistantFailureReasonCodeSchema>;

// Facts are intentionally numeric or boolean. Free-form strings, IDs, source
// aliases, excerpts and provider bodies are not admitted by this schema.
export const GrantAssistantFailureSafeFactsSchema = z.object({
  maximumInputTokens: z.number().int().nonnegative().optional(),
  requiredInputTokens: z.number().int().nonnegative().optional(),
  selectedTargetCount: z.number().int().nonnegative().optional(),
  availableTargetCount: z.number().int().nonnegative().optional(),
  admittedSourceCount: z.number().int().nonnegative().optional(),
  claimCount: z.number().int().nonnegative().optional(),
  citationCount: z.number().int().nonnegative().optional(),
  completedUnitCount: z.number().int().nonnegative().optional(),
  totalUnitCount: z.number().int().nonnegative().optional(),
  attemptNumber: z.number().int().positive().optional(),
  providerStatusCode: z.number().int().min(100).max(599).optional(),
  requestDispatched: z.boolean().optional(),
  usageKnown: z.boolean().optional(),
  hasClarificationQuestion: z.boolean().optional(),
}).strict();
export type GrantAssistantFailureSafeFacts = z.infer<typeof GrantAssistantFailureSafeFactsSchema>;

type FailureReasonDefinition = {
  component: GrantAssistantFailureComponent;
  category: GrantModelFailureCategory;
  allowedStages: readonly GrantAssistantFailureStage[];
};

const ALL_PROVIDER_STAGES = GrantAssistantFailureStageSchema.options;

export const GRANT_ASSISTANT_FAILURE_REASON_DEFINITIONS = {
  "memory.snapshot_contract_invalid": { component: "document_memory", category: "internal_contract_error", allowedStages: ["memory_build"] },
  "memory.stale_revision": { component: "document_memory", category: "internal_contract_error", allowedStages: ["memory_build"] },
  "memory.context_capacity_exceeded": { component: "document_memory", category: "planning_capacity_exceeded", allowedStages: ["memory_build"] },
  "memory.policy_invalid": { component: "document_memory", category: "internal_contract_error", allowedStages: ["memory_build"] },
  "memory.unit_output_invalid": { component: "document_memory", category: "structured_output_invalid", allowedStages: ["memory_build"] },
  "memory.model_identity_mismatch": { component: "document_memory", category: "internal_contract_error", allowedStages: ["memory_build"] },
  "planner.question_missing": { component: "semantic_planner", category: "provider_contract_error", allowedStages: ["semantic_planning"] },
  "planner.memory_contract_invalid": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.stale_memory": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.output_contract_invalid": { component: "semantic_planner", category: "structured_output_invalid", allowedStages: ["semantic_planning"] },
  "planner.unavailable_target": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.targeted_original_missing_target": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.relevant_diagnostic_missing_target": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.clarification_question_missing": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "planner.model_identity_mismatch": { component: "semantic_planner", category: "internal_contract_error", allowedStages: ["semantic_planning"] },
  "budget.policy_limit_invalid": { component: "context_budget", category: "internal_contract_error", allowedStages: ["context_admission"] },
  "budget.current_question_missing": { component: "context_budget", category: "internal_contract_error", allowedStages: ["context_admission"] },
  "budget.planning_required_context_exceeded": { component: "context_budget", category: "planning_capacity_exceeded", allowedStages: ["context_admission"] },
  "budget.answer_required_context_exceeded": { component: "context_budget", category: "answer_capacity_exceeded", allowedStages: ["context_admission"] },
  "budget.review_unit_required_context_exceeded": { component: "context_budget", category: "answer_capacity_exceeded", allowedStages: ["context_admission"] },
  "budget.review_synthesis_required_context_exceeded": { component: "context_budget", category: "answer_capacity_exceeded", allowedStages: ["context_admission"] },
  "context.stale_plan": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.snapshot_contract_invalid": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.output_contract_invalid": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.stale_memory": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.section_anchor_outside_subtree": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.item_anchor_outside_section": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.target_unavailable": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.diagnostics_unavailable": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.diagnostic_contract_invalid": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "context.diagnostic_anchor_invalid": { component: "planned_context", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "review.policy_invalid": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["context_admission"] },
  "review.model_unavailable": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "review.context_mismatch": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["original_retrieval"] },
  "review.coverage_incomplete": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["original_retrieval", "answer_generation"] },
  "review.cited_source_unavailable": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "review.unit_output_invalid": { component: "hierarchical_review", category: "structured_output_invalid", allowedStages: ["answer_generation"] },
  "review.synthesis_output_invalid": { component: "hierarchical_review", category: "structured_output_invalid", allowedStages: ["answer_generation"] },
  "review.model_identity_mismatch": { component: "hierarchical_review", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "answer.ungrounded_claims_present": { component: "grounded_answer_validator", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "answer.output_contract_invalid": { component: "grounded_answer_validator", category: "structured_output_invalid", allowedStages: ["answer_generation"] },
  "answer.model_identity_mismatch": { component: "grounded_answer_validator", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "answer.grounded_bindings_missing": { component: "grounded_answer_validator", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "answer.citation_source_invalid": { component: "grounded_answer_validator", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "answer.claim_citation_invalid": { component: "grounded_answer_validator", category: "internal_contract_error", allowedStages: ["answer_generation"] },
  "provider.output_truncated": { component: "model_adapter", category: "output_truncated", allowedStages: ALL_PROVIDER_STAGES },
  "provider.content_filtered": { component: "model_adapter", category: "content_filtered", allowedStages: ALL_PROVIDER_STAGES },
  "provider.refusal": { component: "model_adapter", category: "provider_refusal", allowedStages: ALL_PROVIDER_STAGES },
  "provider.rate_limited": { component: "model_adapter", category: "provider_rate_limited", allowedStages: ALL_PROVIDER_STAGES },
  "provider.transient_error": { component: "model_adapter", category: "provider_transient_error", allowedStages: ALL_PROVIDER_STAGES },
  "provider.contract_error": { component: "model_adapter", category: "provider_contract_error", allowedStages: ALL_PROVIDER_STAGES },
  "provider.unavailable": { component: "model_adapter", category: "provider_unavailable", allowedStages: ALL_PROVIDER_STAGES },
  "executor.unclassified_failure": { component: "model_executor", category: "internal_contract_error", allowedStages: ALL_PROVIDER_STAGES },
  "persistence.attempt_start_failed": { component: "persistence", category: "internal_contract_error", allowedStages: ["persistence"] },
  "persistence.attempt_finish_failed": { component: "persistence", category: "internal_contract_error", allowedStages: ["persistence"] },
} as const satisfies Record<GrantAssistantFailureReasonCode, FailureReasonDefinition>;

const BaseFailureReasonSchema = z.object({
  contractVersion: z.literal(GRANT_ASSISTANT_FAILURE_REASON_CONTRACT_VERSION),
  reasonCode: GrantAssistantFailureReasonCodeSchema,
  component: GrantAssistantFailureComponentSchema,
  category: GrantAssistantFailureCategorySchema,
  stage: GrantAssistantFailureStageSchema,
  safeFacts: GrantAssistantFailureSafeFactsSchema.default({}),
}).strict();

export const GrantAssistantFailureReasonSchema = BaseFailureReasonSchema.superRefine((reason, context) => {
  const definition = GRANT_ASSISTANT_FAILURE_REASON_DEFINITIONS[reason.reasonCode];
  if (reason.component !== definition.component) {
    context.addIssue({ code: "custom", path: ["component"], message: "Failure component does not own this reason code." });
  }
  if (reason.category !== definition.category) {
    context.addIssue({ code: "custom", path: ["category"], message: "Failure category does not match the registered reason code." });
  }
  const allowedStages: readonly GrantAssistantFailureStage[] = definition.allowedStages;
  if (!allowedStages.includes(reason.stage)) {
    context.addIssue({ code: "custom", path: ["stage"], message: "Failure stage is not valid for this reason code." });
  }
});

export type GrantAssistantFailureReason = z.infer<typeof GrantAssistantFailureReasonSchema>;

export function createGrantAssistantFailureReason(input: {
  reasonCode: GrantAssistantFailureReasonCode;
  stage: GrantAssistantFailureStage;
  safeFacts?: GrantAssistantFailureSafeFacts;
}): GrantAssistantFailureReason {
  const definition = GRANT_ASSISTANT_FAILURE_REASON_DEFINITIONS[input.reasonCode];
  return GrantAssistantFailureReasonSchema.parse({
    contractVersion: GRANT_ASSISTANT_FAILURE_REASON_CONTRACT_VERSION,
    reasonCode: input.reasonCode,
    component: definition.component,
    category: definition.category,
    stage: input.stage,
    safeFacts: input.safeFacts ?? {},
  });
}

const PROVIDER_REASON_BY_CATEGORY = {
  output_truncated: "provider.output_truncated",
  content_filtered: "provider.content_filtered",
  provider_refusal: "provider.refusal",
  provider_rate_limited: "provider.rate_limited",
  provider_transient_error: "provider.transient_error",
  provider_contract_error: "provider.contract_error",
  provider_unavailable: "provider.unavailable",
} as const;

export function createGrantAssistantProviderFailureReason(input: {
  category: keyof typeof PROVIDER_REASON_BY_CATEGORY;
  stage: GrantAssistantFailureStage;
  safeFacts?: GrantAssistantFailureSafeFacts;
}) {
  return createGrantAssistantFailureReason({
    reasonCode: PROVIDER_REASON_BY_CATEGORY[input.category],
    stage: input.stage,
    safeFacts: input.safeFacts,
  });
}
