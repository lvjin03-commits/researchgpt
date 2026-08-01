import {
  DocumentExecutionBudgetSnapshotSchema,
  type DocumentExecutionBudgetSnapshot,
  type DocumentTextExecutionProfile,
} from "./contracts";

export const DOCUMENT_OPERATION_BUDGET_POLICY_VERSION =
  "document-operation-budget-v2";
export const DOCUMENT_MODEL_CAPABILITY_VERSION =
  "document-model-capability-v1";
export const DOCUMENT_PRODUCT_BUDGET_POLICY_VERSION =
  "document-product-budget-observe-v1";

export const DOCUMENT_OPERATION_BUDGETS = {
  "request.understand": {
    expectedOutputTokens: 700,
    preferredMaxOutputTokens: 1_200,
    hardMaxOutputTokens: 1_600,
    escalationAllowed: true,
    reasoningPolicy: "none",
  },
  "template.match": {
    expectedOutputTokens: 400,
    preferredMaxOutputTokens: 800,
    hardMaxOutputTokens: 1_200,
    escalationAllowed: false,
    reasoningPolicy: "none",
  },
  "outline.thesis": {
    expectedOutputTokens: 700,
    preferredMaxOutputTokens: 1_200,
    hardMaxOutputTokens: 1_600,
    escalationAllowed: false,
    reasoningPolicy: "none",
  },
  "outline.section_index": {
    expectedOutputTokens: 1_200,
    preferredMaxOutputTokens: 2_000,
    hardMaxOutputTokens: 2_600,
    escalationAllowed: true,
    reasoningPolicy: "none",
  },
  "outline.figure_intents": {
    expectedOutputTokens: 900,
    preferredMaxOutputTokens: 1_200,
    hardMaxOutputTokens: 1_800,
    escalationAllowed: true,
    reasoningPolicy: "none",
  },
  "outline.section_plan": {
    expectedOutputTokens: 1_200,
    preferredMaxOutputTokens: 1_800,
    hardMaxOutputTokens: 2_400,
    escalationAllowed: true,
    reasoningPolicy: "none",
  },
  "component.title": {
    expectedOutputTokens: 250,
    preferredMaxOutputTokens: 500,
    hardMaxOutputTokens: 800,
    escalationAllowed: false,
    reasoningPolicy: "none",
  },
  "component.abstract": {
    expectedOutputTokens: 1_200,
    preferredMaxOutputTokens: 1_500,
    hardMaxOutputTokens: 2_200,
    escalationAllowed: true,
    reasoningPolicy: "none",
  },
  "component.keywords": {
    expectedOutputTokens: 250,
    preferredMaxOutputTokens: 500,
    hardMaxOutputTokens: 800,
    escalationAllowed: false,
    reasoningPolicy: "none",
  },
  "component.section": {
    expectedOutputTokens: 3_500,
    preferredMaxOutputTokens: 4_500,
    hardMaxOutputTokens: 5_500,
    escalationAllowed: true,
    reasoningPolicy: "inherit",
  },
  "component.conclusion": {
    expectedOutputTokens: 1_500,
    preferredMaxOutputTokens: 1_800,
    hardMaxOutputTokens: 2_800,
    escalationAllowed: true,
    reasoningPolicy: "inherit",
  },
  "component.reference_list": {
    expectedOutputTokens: 500,
    preferredMaxOutputTokens: 800,
    hardMaxOutputTokens: 1_200,
    escalationAllowed: false,
    reasoningPolicy: "none",
  },
} as const;

export type DocumentOperationBudgetKey =
  keyof typeof DOCUMENT_OPERATION_BUDGETS;

const MODEL_OUTPUT_CAPABILITIES: Record<string, number> = {
  "deepseek-v4-flash": 8_192,
  "deepseek-v4-pro": 8_192,
  "gpt-5.4": 16_000,
  "gpt-5.6-sol": 16_000,
};

export function createDocumentExecutionBudgetSnapshot(
  profile: DocumentTextExecutionProfile,
  frozenAt = new Date().toISOString(),
): DocumentExecutionBudgetSnapshot {
  const modelMaxOutputTokens =
    MODEL_OUTPUT_CAPABILITIES[profile.resolvedModelId] ??
    profile.maxOutputTokens;
  // Cost enforcement is intentionally disabled. The product layer remains
  // observable so it can be enabled later only through an explicit policy.
  const productMaxOutputTokensPerOperation = modelMaxOutputTokens;
  const effectiveBudgets = Object.fromEntries(
    Object.entries(DOCUMENT_OPERATION_BUDGETS).map(([operation, budget]) => {
      const effectiveHardMaxOutputTokens = Math.min(
        budget.hardMaxOutputTokens,
        modelMaxOutputTokens,
        productMaxOutputTokensPerOperation,
      );
      return [
        operation,
        {
          ...budget,
          effectivePreferredMaxOutputTokens: Math.min(
            budget.preferredMaxOutputTokens,
            effectiveHardMaxOutputTokens,
          ),
          effectiveHardMaxOutputTokens,
        },
      ];
    }),
  );
  return DocumentExecutionBudgetSnapshotSchema.parse({
    schemaVersion: 1,
    modelCapability: {
      provider: profile.provider,
      requestedModelId: profile.requestedModelId,
      resolvedModelId: profile.resolvedModelId,
      maxOutputTokens: modelMaxOutputTokens,
      capabilityVersion: DOCUMENT_MODEL_CAPABILITY_VERSION,
    },
    productBudgetPolicyVersion: DOCUMENT_PRODUCT_BUDGET_POLICY_VERSION,
    operationBudgetPolicyVersion: DOCUMENT_OPERATION_BUDGET_POLICY_VERSION,
    productBudgetMode: "observe_only",
    productMaxOutputTokensPerOperation,
    effectiveBudgets,
    frozenAt,
  });
}

export function getDocumentOperationBudget(
  snapshot: DocumentExecutionBudgetSnapshot,
  operation: DocumentOperationBudgetKey,
) {
  const budget = snapshot.effectiveBudgets[operation];
  if (!budget) {
    throw new Error(`Document operation budget is missing for "${operation}".`);
  }
  return budget;
}
