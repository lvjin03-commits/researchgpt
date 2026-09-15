import type { GrantFullDocumentContext } from "./grant-full-document-context.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";

export type GrantFullDocumentCapacityPolicy = {
  policyVersion: string;
  contextWindowTokens: number;
  maximumInputTokens: number;
  reservedOutputTokens: number;
  protocolOverheadTokens: number;
  safetyMarginTokens: number;
  maximumSectionsPerChunk?: number;
};

type CapacityFacts = {
  tokenizerId: string;
  policyVersion: string;
  fixedInputTokens: number;
  fullDocumentTokens: number;
  fullRequestInputTokens: number;
  effectiveInputMaximumTokens: number;
  availableDocumentTokens: number;
  reservedOutputTokens: number;
  protocolOverheadTokens: number;
  safetyMarginTokens: number;
};

export type GrantFullDocumentCapacityRoute =
  | { mode: "single_pass"; context: GrantFullDocumentContext; capacity: CapacityFacts }
  | { mode: "hierarchical"; contextHash: string; documentId: string; sourceRevisionId: string;
      capacity: CapacityFacts; chunks: Array<{ chunkIndex: number; sectionAliases: string[];
        modelText: string; tokenCount: number; fitsInputBudget: boolean }>;
      oversizedSectionAliases: string[]; completeSectionCoverage: true }
  | { mode: "unavailable"; reason: "fixed_context_exceeds_capacity"; contextHash: string;
      documentId: string; sourceRevisionId: string; capacity: CapacityFacts };

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

export function routeGrantFullDocumentContext(input: {
  context: GrantFullDocumentContext;
  tokenCounter: GrantTokenCounter;
  fixedPromptText: string;
  policy: GrantFullDocumentCapacityPolicy;
}): GrantFullDocumentCapacityRoute {
  const coverage = input.context.coverage;
  if (!coverage.complete
    || coverage.sectionCount !== input.context.sections.length
    || coverage.coveredSectionCount !== input.context.sections.length
    || coverage.nodeCount !== input.context.nodes.length
    || coverage.coveredNodeCount !== input.context.nodes.length) {
    throw new Error("Capacity routing requires a complete full-document context.");
  }
  const policy = input.policy;
  positiveInteger(policy.contextWindowTokens, "Context window");
  positiveInteger(policy.maximumInputTokens, "Maximum input");
  positiveInteger(policy.reservedOutputTokens, "Reserved output");
  const maximumSectionsPerChunk = policy.maximumSectionsPerChunk == null
    ? Number.POSITIVE_INFINITY
    : positiveInteger(policy.maximumSectionsPerChunk, "Maximum sections per chunk");
  if (![policy.protocolOverheadTokens, policy.safetyMarginTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Protocol overhead and safety margin must be non-negative integers.");
  }
  const contextLimitedInput = policy.contextWindowTokens - policy.reservedOutputTokens - policy.safetyMarginTokens;
  const effectiveInputMaximumTokens = Math.min(policy.maximumInputTokens, contextLimitedInput);
  const fixedInputTokens = input.tokenCounter.count(input.fixedPromptText);
  const fullDocumentTokens = input.tokenCounter.count(input.context.modelText);
  const fullRequestInputTokens = fixedInputTokens + fullDocumentTokens + policy.protocolOverheadTokens;
  const availableDocumentTokens = effectiveInputMaximumTokens - fixedInputTokens - policy.protocolOverheadTokens;
  const capacity: CapacityFacts = { tokenizerId: input.tokenCounter.tokenizerId,
    policyVersion: policy.policyVersion, fixedInputTokens, fullDocumentTokens, fullRequestInputTokens,
    effectiveInputMaximumTokens, availableDocumentTokens, reservedOutputTokens: policy.reservedOutputTokens,
    protocolOverheadTokens: policy.protocolOverheadTokens, safetyMarginTokens: policy.safetyMarginTokens };
  if (availableDocumentTokens <= 0) return { mode: "unavailable", reason: "fixed_context_exceeds_capacity",
    contextHash: input.context.contextHash, documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId, capacity };
  if (fullRequestInputTokens <= effectiveInputMaximumTokens
    && input.context.sections.length <= maximumSectionsPerChunk) return { mode: "single_pass",
    context: input.context, capacity };

  const title = `申请书标题：${input.context.title}`;
  const chunks: Extract<GrantFullDocumentCapacityRoute, { mode: "hierarchical" }>["chunks"] = [];
  let sectionAliases: string[] = [];
  let sectionTexts: string[] = [];
  const flush = () => {
    if (sectionAliases.length === 0) return;
    const modelText = [title, ...sectionTexts].join("\n\n");
    const tokenCount = input.tokenCounter.count(modelText);
    chunks.push({ chunkIndex: chunks.length, sectionAliases, modelText, tokenCount,
      fitsInputBudget: tokenCount <= availableDocumentTokens });
    sectionAliases = [];
    sectionTexts = [];
  };
  for (const section of input.context.sections) {
    const candidateText = [title, ...sectionTexts, section.modelText].join("\n\n");
    if (sectionTexts.length > 0 && (sectionAliases.length >= maximumSectionsPerChunk
      || input.tokenCounter.count(candidateText) > availableDocumentTokens)) flush();
    sectionAliases.push(section.sectionAlias);
    sectionTexts.push(section.modelText);
  }
  flush();
  const covered = chunks.flatMap((chunk) => chunk.sectionAliases);
  if (covered.length !== input.context.sections.length || new Set(covered).size !== input.context.sections.length) {
    throw new Error("Capacity routing did not preserve complete section coverage.");
  }
  return { mode: "hierarchical", contextHash: input.context.contextHash,
    documentId: input.context.documentId, sourceRevisionId: input.context.sourceRevisionId,
    capacity, chunks, oversizedSectionAliases: chunks.filter((chunk) => !chunk.fitsInputBudget)
      .flatMap((chunk) => chunk.sectionAliases), completeSectionCoverage: true };
}
