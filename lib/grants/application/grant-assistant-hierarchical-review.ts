import { buildGrantFullDocumentSynthesisMessages,
  buildGrantFullDocumentUnitMessages } from "../assistant/grant-full-document-review-request.ts";
import { validateGrantAssistantGroundedAnswer } from "../assistant/grounded-answer-validator.ts";
import type { GrantAssistantAnswer } from "../assistant/answer-contract.ts";
import { GrantAssistantModelError, type GrantAssistantAdmittedContext } from "../ports/grant-assistant-model.ts";
import type { GrantFullDocumentAnalysisModel } from "../ports/grant-full-document-analysis-model.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import type { GrantAssistantPlannedContext } from "../assistant/planned-context-contracts.ts";
import type { GrantFullDocumentContext } from "./grant-full-document-context.ts";
import { routeGrantFullDocumentContext,
  type GrantFullDocumentCapacityRoute } from "./grant-full-document-capacity-router.ts";
import { executeGrantFullDocumentHierarchicalAnalysis } from "./grant-full-document-hierarchical-analysis.ts";
import { admitGrantAssistantFixedContext,
  type GrantAssistantContextBudgetManifest,
  type GrantAssistantContextBudgetPolicy } from "./grant-assistant-context-budget.ts";
import { createGrantAssistantFailureReason, GrantAssistantFailureReasonSchema } from "../model-execution/assistant-failure-reasons.ts";
import { GrantFullDocumentAnalysisError } from "./grant-full-document-hierarchical-analysis.ts";

type HierarchicalRoute = Extract<GrantFullDocumentCapacityRoute, { mode: "hierarchical" }>;

function forceHierarchicalRoute(input: {
  context: GrantFullDocumentContext;
  tokenCounter: GrantTokenCounter;
  budget: NonNullable<GrantAssistantContextBudgetPolicy["fullDocumentReview"]>;
}): HierarchicalRoute {
  const documentLanguage = /[\u3400-\u9fff]/u.test(input.context.title) ? "zh" : "en";
  const fixedUnitMessages = buildGrantFullDocumentUnitMessages({ documentLanguage,
    question: "", contextHash: input.context.contextHash, unitId: "",
    modelText: "", allowedSourceAliases: [], maximumOutputTokens: input.budget.maximumUnitOutputTokens });
  const route = routeGrantFullDocumentContext({
    context: input.context,
    tokenCounter: input.tokenCounter,
    fixedPromptText: fixedUnitMessages.map((message) => `${message.role}\n${message.content}`).join("\n"),
    policy: {
      policyVersion: "grant-assistant-full-review-capacity-v1",
      contextWindowTokens: input.budget.maximumUnitInputTokens + input.budget.maximumUnitOutputTokens + 512,
      maximumInputTokens: input.budget.maximumUnitInputTokens,
      reservedOutputTokens: input.budget.maximumUnitOutputTokens,
      protocolOverheadTokens: 256,
      safetyMarginTokens: 256,
      maximumSectionsPerChunk: input.budget.maximumSectionsPerUnit,
    },
  });
  if (route.mode === "unavailable") {
    throw new GrantFullDocumentAnalysisError("unit_capacity_exceeded",
      "The full-document review prompt leaves no capacity for document content.");
  }
  if (route.mode === "hierarchical") return route;
  return {
    mode: "hierarchical",
    contextHash: input.context.contextHash,
    documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId,
    capacity: route.capacity,
    chunks: [{ chunkIndex: 0,
      sectionAliases: input.context.sections.map((section) => section.sectionAlias),
      modelText: input.context.modelText,
      tokenCount: input.tokenCounter.count(input.context.modelText), fitsInputBudget: true }],
    oversizedSectionAliases: [],
    completeSectionCoverage: true,
  };
}

export async function executeGrantAssistantHierarchicalReview(input: {
  context: GrantFullDocumentContext;
  plannedContext: GrantAssistantPlannedContext;
  question: string;
  model: GrantFullDocumentAnalysisModel;
  tokenCounter: GrantTokenCounter;
  contextBudgetPolicy: GrantAssistantContextBudgetPolicy;
}) {
  const budget = input.contextBudgetPolicy.fullDocumentReview;
  if (!budget) throw new GrantAssistantModelError("internal_contract_error",
    "Full-document review context policy is not configured.", {
      failureStage: "context_admission", requestDispatched: false, usageKnown: true,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
      failureReason: createGrantAssistantFailureReason({ reasonCode: "review.policy_invalid",
        stage: "context_admission", safeFacts: { requestDispatched: false, usageKnown: true } }),
    });
  const route = forceHierarchicalRoute({ context: input.context, tokenCounter: input.tokenCounter, budget });
  const manifests: GrantAssistantContextBudgetManifest[] = [];
  const diagnostics = input.plannedContext.sources.filter((source) => source.sourceType === "diagnostic");
  const supplementalAnalyses = diagnostics.length === 0 ? [] : [{
    unitId: "CURRENT_DIAGNOSTICS",
    summary: "Current program-validated diagnostic findings for this Revision.",
    findings: diagnostics.map((source) => ({ statement: source.excerpt, sourceAliases: [source.sourceAlias] })),
  }];
  const execution = await executeGrantFullDocumentHierarchicalAnalysis({
    context: input.context,
    route,
    tokenCounter: input.tokenCounter,
    model: input.model,
    question: input.question,
    unitMaximumOutputTokens: budget.maximumUnitOutputTokens,
    synthesisMaximumInputTokens: budget.maximumSynthesisInputTokens,
    synthesisMaximumOutputTokens: budget.maximumSynthesisOutputTokens,
    maximumUnits: budget.maximumUnits,
    supplementalAnalyses,
    supplementalSourceAliases: diagnostics.map((source) => source.sourceAlias),
    beforeUnit(request) {
      manifests.push(admitGrantAssistantFixedContext({ stage: "full_review_unit",
        budget: { maximumInputTokens: budget.maximumUnitInputTokens,
          maximumOutputTokens: budget.maximumUnitOutputTokens },
        modelId: input.contextBudgetPolicy.modelId,
        sourceAliases: request.allowedSourceAliases,
        providerMessages: buildGrantFullDocumentUnitMessages(request), tokenCounter: input.tokenCounter }));
    },
    beforeSynthesis(request) {
      manifests.push(admitGrantAssistantFixedContext({ stage: "full_review_synthesis",
        budget: { maximumInputTokens: budget.maximumSynthesisInputTokens,
          maximumOutputTokens: budget.maximumSynthesisOutputTokens },
        modelId: input.contextBudgetPolicy.modelId,
        sourceAliases: request.allowedSourceAliases,
        providerMessages: buildGrantFullDocumentSynthesisMessages(request), tokenCounter: input.tokenCounter }));
    },
  });

  const citedAliases = [...new Set(execution.answer.claims.flatMap((claim) => claim.sourceAliases))];
  const nodeByAlias = new Map(input.context.nodes.map((node) => [node.sourceAlias, node]));
  const sectionByAlias = new Map(input.context.sections.map((section) => [section.sectionAlias, section]));
  const diagnosticByAlias = new Map(diagnostics.map((source) => [source.sourceAlias, source]));
  let originalIndex = 0;
  const canonicalAlias = new Map(citedAliases.map((alias) => [alias,
    alias.startsWith("D") ? `O${++originalIndex}` : alias]));
  const admittedContext: GrantAssistantAdmittedContext[] = citedAliases.map((alias) => {
    const node = nodeByAlias.get(alias);
    if (node) {
      const section = sectionByAlias.get(node.sectionAlias)!;
      return { sourceAlias: canonicalAlias.get(alias)!, sourceType: "original_text" as const,
        label: `${section.title} / 原文`, excerpt: node.text };
    }
    const diagnostic = diagnosticByAlias.get(alias);
    if (!diagnostic) throw new GrantAssistantModelError("internal_contract_error",
      "Full-document review cited an unavailable source.", {
        providerRequestIds: execution.providerRequestIds, usage: execution.usage,
        failureStage: "answer_generation", requestDispatched: execution.providerRequestIds.length > 0,
        usageKnown: true,
        failureReason: createGrantAssistantFailureReason({ reasonCode: "review.cited_source_unavailable",
          stage: "answer_generation", safeFacts: { admittedSourceCount: citedAliases.length,
            requestDispatched: execution.providerRequestIds.length > 0, usageKnown: true } }),
      });
    return { sourceAlias: alias, sourceType: "diagnostic" as const,
      label: diagnostic.label, excerpt: diagnostic.excerpt };
  });
  const citationIdByAlias = new Map(citedAliases.map((alias, index) => [alias, `FDR${index + 1}`]));
  let answer: GrantAssistantAnswer;
  try {
    answer = validateGrantAssistantGroundedAnswer({
      content: execution.answer.content,
      admittedContext,
      claims: execution.answer.claims.map((claim, index) => ({ claimId: `FDC${index + 1}`,
        statement: claim.statement,
        citationIds: claim.sourceAliases.map((alias) => citationIdByAlias.get(alias)!) })),
      citations: citedAliases.map((alias) => ({ citationId: citationIdByAlias.get(alias)!,
        sourceAlias: canonicalAlias.get(alias)! })),
    });
  } catch (error) {
    const attributed = GrantAssistantFailureReasonSchema.safeParse((error as { failureReason?: unknown })?.failureReason);
    throw new GrantAssistantModelError(attributed.success ? attributed.data.category : "internal_contract_error",
      error instanceof Error ? error.message : "Full-document grounding validation failed.", {
        providerRequestIds: execution.providerRequestIds, usage: execution.usage,
        failureStage: "answer_generation", requestDispatched: execution.providerRequestIds.length > 0,
        usageKnown: true,
        failureReason: attributed.success ? attributed.data : createGrantAssistantFailureReason({
          reasonCode: "executor.unclassified_failure", stage: "answer_generation",
          safeFacts: { requestDispatched: execution.providerRequestIds.length > 0, usageKnown: true } }),
      });
  }
  return { execution, answer, admittedContext, contextManifests: manifests };
}
