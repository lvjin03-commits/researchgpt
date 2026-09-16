import { buildGrantAssistantChatMessages, buildGrantAssistantPlanningMessages,
  type GrantAssistantProviderMessage } from "../assistant/grant-assistant-model-request.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantAssistantAdmittedContext, GrantAssistantChatMessage,
  GrantAssistantChatModelRequest } from "../ports/grant-assistant-model.ts";
import type { GrantAssistantContextPlanModelRequest } from "../ports/grant-assistant-context-planner-model.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import { createGrantAssistantFailureReason,
  type GrantAssistantFailureReason } from "../model-execution/assistant-failure-reasons.ts";

export const GRANT_ASSISTANT_CONTEXT_BUDGET_POLICY_VERSION =
  "grant-assistant-context-budget-v2" as const;

type ConversationMessage = Pick<GrantAssistantChatMessage, "role" | "content">;
export type GrantAssistantContextBudgetStage = "semantic_planning" | "grounded_answer" |
  "full_review_unit" | "full_review_synthesis";

export type GrantAssistantStageBudget = {
  maximumInputTokens: number;
  maximumOutputTokens: number;
};

export type GrantAssistantContextBudgetPolicy = {
  modelId: string;
  semanticPlanning: GrantAssistantStageBudget;
  groundedAnswer: GrantAssistantStageBudget;
  fullDocumentReview?: {
    maximumUnitInputTokens: number;
    maximumUnitOutputTokens: number;
    maximumSynthesisInputTokens: number;
    maximumSynthesisOutputTokens: number;
    maximumUnits: number;
    maximumSectionsPerUnit: number;
  };
};

export type GrantAssistantContextBudgetManifest = {
  policyVersion: typeof GRANT_ASSISTANT_CONTEXT_BUDGET_POLICY_VERSION;
  stage: GrantAssistantContextBudgetStage;
  status: "complete" | "context_adapted";
  modelId: string;
  tokenizerId: string;
  maximumInputTokens: number;
  reservedOutputTokens: number;
  providerFramingReserveTokens: number;
  structuredOutputReserveTokens: number;
  requiredInputTokens: number;
  estimatedInputTokens: number;
  admittedSourceAliases: string[];
  admittedConversationMessages: number;
  omittedConversationMessages: number;
  payloadHash: string;
};

export class GrantAssistantContextBudgetError extends Error {
  readonly code: "planning_capacity_exceeded" | "answer_capacity_exceeded";
  readonly stage: GrantAssistantContextBudgetStage;
  readonly maximumInputTokens: number;
  readonly requiredInputTokens: number;
  readonly failureStage = "context_admission" as const;
  readonly requestDispatched = false;
  readonly usageKnown = true;
  readonly usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  readonly failureReason: GrantAssistantFailureReason;

  constructor(input: {
    stage: GrantAssistantContextBudgetStage;
    maximumInputTokens: number;
    requiredInputTokens: number;
  }) {
    super(`Required ${input.stage} context does not fit the configured model-input capacity.`);
    this.name = "GrantAssistantContextBudgetError";
    this.code = input.stage === "semantic_planning"
      ? "planning_capacity_exceeded"
      : "answer_capacity_exceeded";
    this.stage = input.stage;
    this.maximumInputTokens = input.maximumInputTokens;
    this.requiredInputTokens = input.requiredInputTokens;
    const reasonCode = input.stage === "semantic_planning"
      ? "budget.planning_required_context_exceeded" as const
      : input.stage === "full_review_unit"
        ? "budget.review_unit_required_context_exceeded" as const
        : input.stage === "full_review_synthesis"
          ? "budget.review_synthesis_required_context_exceeded" as const
          : "budget.answer_required_context_exceeded" as const;
    this.failureReason = createGrantAssistantFailureReason({ reasonCode,
      stage: "context_admission", safeFacts: {
        maximumInputTokens: input.maximumInputTokens,
        requiredInputTokens: input.requiredInputTokens,
        requestDispatched: false,
        usageKnown: true,
      } });
  }
}

export class GrantAssistantContextPolicyError extends Error {
  readonly failureStage = "context_admission" as const;
  readonly requestDispatched = false;
  readonly usageKnown = true;
  readonly usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  readonly failureReason: GrantAssistantFailureReason;

  constructor(reasonCode: "budget.policy_limit_invalid" | "budget.current_question_missing", message: string) {
    super(message);
    this.name = "GrantAssistantContextPolicyError";
    this.failureReason = createGrantAssistantFailureReason({ reasonCode, stage: "context_admission",
      safeFacts: { requestDispatched: false, usageKnown: true } });
  }
}

// Provider framing and structured-output schema tokens are not present in the
// business payload. The sole admission owner counts explicit conservative
// reserves instead of leaving hidden per-adapter allowances.
const PROVIDER_FRAMING_RESERVE_TOKENS = 256;
const STRUCTURED_OUTPUT_RESERVE_TOKENS: Record<GrantAssistantContextBudgetStage, number> = {
  semantic_planning: 640,
  grounded_answer: 768,
  full_review_unit: 512,
  full_review_synthesis: 768,
};

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new GrantAssistantContextPolicyError(
    "budget.policy_limit_invalid", `${label} must be a positive integer.`);
}

function countProviderRequest(messages: GrantAssistantProviderMessage[], tokenCounter: GrantTokenCounter,
  stage: GrantAssistantContextBudgetStage) {
  const messageFramingTokens = messages.length * 8;
  return messages.reduce((total, message) => total
    + tokenCounter.count(message.role)
    + tokenCounter.count(message.content), 0)
    + messageFramingTokens
    + PROVIDER_FRAMING_RESERVE_TOKENS
    + STRUCTURED_OUTPUT_RESERVE_TOKENS[stage];
}

export function admitGrantAssistantFixedContext(input: {
  stage: "full_review_unit" | "full_review_synthesis";
  budget: GrantAssistantStageBudget;
  modelId: string;
  sourceAliases: string[];
  providerMessages: GrantAssistantProviderMessage[];
  tokenCounter: GrantTokenCounter;
}): GrantAssistantContextBudgetManifest {
  positiveInteger(input.budget.maximumInputTokens, "Maximum input tokens");
  positiveInteger(input.budget.maximumOutputTokens, "Maximum output tokens");
  const inputTokens = countProviderRequest(input.providerMessages, input.tokenCounter, input.stage);
  if (inputTokens > input.budget.maximumInputTokens) {
    throw new GrantAssistantContextBudgetError({ stage: input.stage,
      maximumInputTokens: input.budget.maximumInputTokens, requiredInputTokens: inputTokens });
  }
  return {
    policyVersion: GRANT_ASSISTANT_CONTEXT_BUDGET_POLICY_VERSION,
    stage: input.stage,
    status: "complete",
    modelId: input.modelId,
    tokenizerId: input.tokenCounter.tokenizerId,
    maximumInputTokens: input.budget.maximumInputTokens,
    reservedOutputTokens: input.budget.maximumOutputTokens,
    providerFramingReserveTokens: PROVIDER_FRAMING_RESERVE_TOKENS,
    structuredOutputReserveTokens: STRUCTURED_OUTPUT_RESERVE_TOKENS[input.stage],
    requiredInputTokens: inputTokens,
    estimatedInputTokens: inputTokens,
    admittedSourceAliases: [...input.sourceAliases],
    admittedConversationMessages: 0,
    omittedConversationMessages: 0,
    payloadHash: sha256Canonical(input.providerMessages),
  };
}

function admitNewestConversation<TRequest>(input: {
  stage: GrantAssistantContextBudgetStage;
  budget: GrantAssistantStageBudget;
  modelId: string;
  sourceAliases: string[];
  conversation: ConversationMessage[];
  assembleRequest: (conversation: ConversationMessage[]) => TRequest;
  buildProviderMessages: (request: TRequest) => GrantAssistantProviderMessage[];
  tokenCounter: GrantTokenCounter;
}) {
  positiveInteger(input.budget.maximumInputTokens, "Maximum input tokens");
  positiveInteger(input.budget.maximumOutputTokens, "Maximum output tokens");
  const measure = (conversation: ConversationMessage[]) => {
    const request = input.assembleRequest(conversation);
    const providerMessages = input.buildProviderMessages(request);
    return { request, providerMessages,
      inputTokens: countProviderRequest(providerMessages, input.tokenCounter, input.stage) };
  };
  const required = measure([]);
  if (required.inputTokens > input.budget.maximumInputTokens) {
    throw new GrantAssistantContextBudgetError({ stage: input.stage,
      maximumInputTokens: input.budget.maximumInputTokens, requiredInputTokens: required.inputTokens });
  }

  const admitted: ConversationMessage[] = [];
  for (let index = input.conversation.length - 1; index >= 0; index -= 1) {
    const candidate = [input.conversation[index]!, ...admitted];
    if (measure(candidate).inputTokens > input.budget.maximumInputTokens) break;
    admitted.unshift(input.conversation[index]!);
  }
  const final = measure(admitted);
  const omittedConversationMessages = input.conversation.length - admitted.length;
  return {
    request: final.request,
    manifest: {
      policyVersion: GRANT_ASSISTANT_CONTEXT_BUDGET_POLICY_VERSION,
      stage: input.stage,
      status: omittedConversationMessages > 0 ? "context_adapted" : "complete",
      modelId: input.modelId,
      tokenizerId: input.tokenCounter.tokenizerId,
      maximumInputTokens: input.budget.maximumInputTokens,
      reservedOutputTokens: input.budget.maximumOutputTokens,
      providerFramingReserveTokens: PROVIDER_FRAMING_RESERVE_TOKENS,
      structuredOutputReserveTokens: STRUCTURED_OUTPUT_RESERVE_TOKENS[input.stage],
      requiredInputTokens: required.inputTokens,
      estimatedInputTokens: final.inputTokens,
      admittedSourceAliases: [...input.sourceAliases],
      admittedConversationMessages: admitted.length,
      omittedConversationMessages,
      payloadHash: sha256Canonical(final.providerMessages),
    } satisfies GrantAssistantContextBudgetManifest,
  };
}

export function admitGrantAssistantPlanningContext(input: {
  documentLanguage: "zh" | "en";
  question: string;
  documentMemoryText: string;
  allowedSectionAliases: string[];
  allowedMemoryItemAliases: string[];
  explicitContext: GrantAssistantContextPlanModelRequest["explicitContext"];
  recentConversation: ConversationMessage[];
  budgetPolicy: GrantAssistantContextBudgetPolicy;
  tokenCounter: GrantTokenCounter;
}) {
  const budget = input.budgetPolicy.semanticPlanning;
  const assembleRequest = (recentConversation: ConversationMessage[]): GrantAssistantContextPlanModelRequest => ({
    documentLanguage: input.documentLanguage,
    question: input.question,
    documentMemoryText: input.documentMemoryText,
    allowedSectionAliases: input.allowedSectionAliases,
    allowedMemoryItemAliases: input.allowedMemoryItemAliases,
    explicitContext: input.explicitContext,
    recentConversation,
    maximumOutputTokens: budget.maximumOutputTokens,
  });
  return admitNewestConversation({ stage: "semantic_planning", budget,
    modelId: input.budgetPolicy.modelId, sourceAliases: [], conversation: input.recentConversation,
    assembleRequest, buildProviderMessages: buildGrantAssistantPlanningMessages,
    tokenCounter: input.tokenCounter });
}

export function admitGrantAssistantAnswerContext(input: {
  documentLanguage: "zh" | "en";
  messages: ConversationMessage[];
  admittedContext: GrantAssistantAdmittedContext[];
  contextPlan?: GrantAssistantChatModelRequest["contextPlan"];
  attemptPurpose: GrantAssistantChatModelRequest["attemptPurpose"];
  budgetPolicy: GrantAssistantContextBudgetPolicy;
  tokenCounter: GrantTokenCounter;
}) {
  const current = input.messages.at(-1);
  if (!current || current.role !== "user") {
    throw new GrantAssistantContextPolicyError("budget.current_question_missing",
      "The current user question is required for context admission.");
  }
  const budget = input.budgetPolicy.groundedAnswer;
  const assembleRequest = (history: ConversationMessage[]): GrantAssistantChatModelRequest => ({
    documentLanguage: input.documentLanguage,
    messages: [...history, current],
    admittedContext: input.admittedContext,
    ...(input.contextPlan ? { contextPlan: input.contextPlan } : {}),
    attemptPurpose: input.attemptPurpose,
    maximumOutputTokens: budget.maximumOutputTokens,
  });
  return admitNewestConversation({ stage: "grounded_answer", budget,
    modelId: input.budgetPolicy.modelId,
    sourceAliases: input.admittedContext.map((source) => source.sourceAlias),
    conversation: input.messages.slice(0, -1), assembleRequest,
    buildProviderMessages: buildGrantAssistantChatMessages, tokenCounter: input.tokenCounter });
}
