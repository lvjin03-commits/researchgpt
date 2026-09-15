import { randomUUID } from "node:crypto";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from "../assistant/document-memory-contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { GrantAssistantModelError } from "../ports/grant-assistant-model.ts";
import type { GrantDocumentMemoryModel, GrantDocumentMemoryModelMetadata,
  GrantDocumentMemorySectionProposal, GrantDocumentMemorySemanticItemProposal,
  GrantDocumentMemorySynthesis, GrantDocumentMemoryUnitAnalysis } from "../ports/grant-document-memory-model.ts";
import type { GrantDocumentMemoryRepository } from "../ports/grant-document-memory-repository.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import { buildGrantFullDocumentAnalysisUnits, type GrantFullDocumentAnalysisUnit } from "./grant-full-document-hierarchical-analysis.ts";
import type { GrantFullDocumentCapacityRoute } from "./grant-full-document-capacity-router.ts";
import type { GrantFullDocumentContext } from "./grant-full-document-context.ts";

export class GrantDocumentMemoryError extends Error {
  readonly code: "context_unavailable" | "invalid_model_output" | "incomplete_section_memory" |
    "synthesis_capacity_exceeded" | "inconsistent_model_identity";
  constructor(code: GrantDocumentMemoryError["code"], message: string) {
    super(message);
    this.name = "GrantDocumentMemoryError";
    this.code = code;
  }
}

type MemoryUnit = Pick<GrantFullDocumentAnalysisUnit, "unitId" | "sectionAliases" | "sourceAliases" | "modelText">;

function buildUnits(input: { context: GrantFullDocumentContext; route: GrantFullDocumentCapacityRoute;
  tokenCounter: GrantTokenCounter }): MemoryUnit[] {
  if (input.route.mode === "unavailable") throw new GrantDocumentMemoryError("context_unavailable",
    "The fixed memory prompt leaves no capacity for grant content.");
  if (input.route.mode === "single_pass") return [{ unitId: "FULL", modelText: input.context.modelText,
    sectionAliases: input.context.sections.map((section) => section.sectionAlias),
    sourceAliases: input.context.nodes.map((node) => node.sourceAlias) }];
  return buildGrantFullDocumentAnalysisUnits({ context: input.context, route: input.route,
    tokenCounter: input.tokenCounter });
}

function validateAliases(input: { sections: GrantDocumentMemorySectionProposal[];
  items: GrantDocumentMemorySemanticItemProposal[]; allowedSections: ReadonlySet<string>;
  allowedSources: ReadonlySet<string> }) {
  for (const section of input.sections) {
    if (!section.summary.trim() || !input.allowedSections.has(section.sectionAlias)
      || section.sourceAliases.some((alias) => !input.allowedSources.has(alias))) {
      throw new GrantDocumentMemoryError("invalid_model_output", "Memory section referenced unavailable grant content.");
    }
  }
  for (const item of input.items) {
    if (!item.statement.trim() || item.sourceAliases.length === 0
      || item.sourceAliases.some((alias) => !input.allowedSources.has(alias))) {
      throw new GrantDocumentMemoryError("invalid_model_output", "Memory item referenced unavailable grant content.");
    }
  }
}

function addMetadata(target: { requestIds: string[]; usage: GrantDocumentMemorySnapshot["usage"];
  identities: Set<string> }, metadata: GrantDocumentMemoryModelMetadata) {
  if (metadata.providerRequestId) target.requestIds.push(metadata.providerRequestId);
  target.usage.inputTokens += metadata.usage?.inputTokens ?? 0;
  target.usage.outputTokens += metadata.usage?.outputTokens ?? 0;
  target.usage.reasoningTokens += metadata.usage?.reasoningTokens ?? 0;
  if (metadata.provider && metadata.modelId) target.identities.add(`${metadata.provider}:${metadata.modelId}`);
}

function accumulateFailureMetadata(error: unknown, accumulated: GrantDocumentMemorySnapshot["usage"]) {
  if (!(error instanceof GrantAssistantModelError)) return error;
  return new GrantAssistantModelError(error.category, error.message, {
    ...(error.providerRequestId ? { providerRequestId: error.providerRequestId } : {}),
    usage: {
      inputTokens: accumulated.inputTokens + (error.usage?.inputTokens ?? 0),
      outputTokens: accumulated.outputTokens + (error.usage?.outputTokens ?? 0),
      reasoningTokens: accumulated.reasoningTokens + (error.usage?.reasoningTokens ?? 0),
    },
  });
}

export async function buildGrantDocumentMemory(input: {
  context: GrantFullDocumentContext;
  route: GrantFullDocumentCapacityRoute;
  tokenCounter: GrantTokenCounter;
  model: GrantDocumentMemoryModel;
  repository: GrantDocumentMemoryRepository;
  policyVersion: string;
  synthesisMaximumInputTokens: number;
  unitMaximumOutputTokens: number;
  synthesisMaximumOutputTokens: number;
  attemptPurpose: "initial" | "schema_repair" | "capacity_retry" | "transient_retry";
  now?: () => string;
  createId?: () => string;
}): Promise<{ snapshot: GrantDocumentMemorySnapshot; reused: boolean }> {
  const reusable = await input.repository.findReusable({ documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId, contextHash: input.context.contextHash,
    policyVersion: input.policyVersion });
  if (reusable) return { snapshot: GrantDocumentMemorySnapshotSchema.parse(reusable), reused: true };
  if (!Number.isSafeInteger(input.synthesisMaximumInputTokens) || input.synthesisMaximumInputTokens <= 0) {
    throw new Error("Memory synthesis maximum input tokens must be a positive integer.");
  }
  if (![input.unitMaximumOutputTokens, input.synthesisMaximumOutputTokens]
    .every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Memory output-token limits must be positive integers.");
  }

  const units = buildUnits(input);
  const documentLanguage = /[\u3400-\u9fff]/u.test(input.context.title) ? "zh" : "en";
  const metadata = { requestIds: [] as string[], usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    identities: new Set<string>() };
  const analyses: Array<MemoryUnit & { analysis: GrantDocumentMemoryUnitAnalysis }> = [];
  for (const unit of units) {
    let analysis: GrantDocumentMemoryUnitAnalysis;
    try {
      analysis = await input.model.analyzeMemoryUnit({ documentLanguage, contextHash: input.context.contextHash,
        unitId: unit.unitId, modelText: unit.modelText, allowedSectionAliases: unit.sectionAliases,
        allowedSourceAliases: unit.sourceAliases, attemptPurpose: input.attemptPurpose,
        maximumOutputTokens: input.unitMaximumOutputTokens });
    } catch (error) {
      throw accumulateFailureMetadata(error, metadata.usage);
    }
    if (!analysis.summary.trim()) throw new GrantDocumentMemoryError("invalid_model_output",
      "Memory unit analysis returned an empty summary.");
    validateAliases({ sections: analysis.sectionSummaries, items: analysis.semanticItems,
      allowedSections: new Set(unit.sectionAliases), allowedSources: new Set(unit.sourceAliases) });
    addMetadata(metadata, analysis);
    analyses.push({ ...unit, analysis });
  }

  const synthesisInput = analyses.map(({ unitId, analysis }) => ({ unitId, summary: analysis.summary,
    sectionSummaries: analysis.sectionSummaries, semanticItems: analysis.semanticItems }));
  if (input.tokenCounter.count(JSON.stringify(synthesisInput)) > input.synthesisMaximumInputTokens) {
    throw new GrantDocumentMemoryError("synthesis_capacity_exceeded",
      "Complete memory analyses exceed the declared synthesis input budget.");
  }
  const allSections = new Set(input.context.sections.map((section) => section.sectionAlias));
  const allSources = new Set(input.context.nodes.map((node) => node.sourceAlias));
  let synthesis: GrantDocumentMemorySynthesis;
  try {
    synthesis = await input.model.synthesizeMemory({ documentLanguage, contextHash: input.context.contextHash,
      analyses: synthesisInput, allowedSectionAliases: [...allSections], allowedSourceAliases: [...allSources],
      attemptPurpose: input.attemptPurpose, maximumOutputTokens: input.synthesisMaximumOutputTokens });
  } catch (error) {
    throw accumulateFailureMetadata(error, metadata.usage);
  }
  if (!synthesis.overview.trim()) throw new GrantDocumentMemoryError("invalid_model_output",
    "Memory synthesis returned an empty overview.");
  validateAliases({ sections: synthesis.sectionSummaries, items: synthesis.semanticItems,
    allowedSections: allSections, allowedSources: allSources });
  const sectionAliases = synthesis.sectionSummaries.map((section) => section.sectionAlias);
  if (sectionAliases.length !== input.context.sections.length || new Set(sectionAliases).size !== allSections.size
    || sectionAliases.some((alias) => !allSections.has(alias))) {
    throw new GrantDocumentMemoryError("incomplete_section_memory",
      "Memory synthesis must summarize every canonical section exactly once.");
  }
  addMetadata(metadata, synthesis);
  if (metadata.identities.size !== 1) throw new GrantDocumentMemoryError("inconsistent_model_identity",
    "All memory stages must report one consistent provider and model identity.");
  const [provider, modelId] = [...metadata.identities][0]!.split(":", 2);
  if (provider !== "openai" || !modelId) throw new GrantDocumentMemoryError("inconsistent_model_identity",
    "Grant document memory currently admits only the configured OpenAI provider.");

  const sectionByAlias = new Map(input.context.sections.map((section) => [section.sectionAlias, section]));
  const nodeByAlias = new Map(input.context.nodes.map((node) => [node.sourceAlias, node]));
  const sections = synthesis.sectionSummaries.map((proposal) => {
    const section = sectionByAlias.get(proposal.sectionAlias)!;
    return { sectionId: section.sectionId, title: section.title, semanticRole: section.semanticRole,
      summary: proposal.summary, sourceNodeIds: proposal.sourceAliases.map((alias) => nodeByAlias.get(alias)!.nodeId) };
  });
  const items = synthesis.semanticItems.map((proposal, index) => ({ memoryItemId: `M${index + 1}`,
    kind: proposal.kind, statement: proposal.statement, concepts: [...new Set(proposal.concepts.map((item) => item.trim()).filter(Boolean))].slice(0, 12),
    sourceSectionIds: [...new Set(proposal.sourceAliases.map((alias) =>
      sectionByAlias.get(nodeByAlias.get(alias)!.sectionAlias)!.sectionId))],
    sourceNodeIds: [...new Set(proposal.sourceAliases.map((alias) => nodeByAlias.get(alias)!.nodeId))] }));
  const content = { overview: synthesis.overview, sections, items };
  const snapshot = GrantDocumentMemorySnapshotSchema.parse({ schemaVersion: "grant-document-memory-v1",
    memoryId: (input.createId ?? randomUUID)(), documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId, contextHash: input.context.contextHash,
    memoryHash: sha256Canonical(content), policyVersion: input.policyVersion, provider: "openai", modelId,
    builtAt: (input.now ?? (() => new Date().toISOString()))(), ...content,
    coverage: { sectionCount: input.context.coverage.sectionCount, nodeCount: input.context.coverage.nodeCount,
      coveredSectionCount: input.context.coverage.coveredSectionCount,
      coveredNodeCount: input.context.coverage.coveredNodeCount, complete: true },
    usage: metadata.usage, providerRequestIds: metadata.requestIds });
  return { snapshot: await input.repository.save(snapshot), reused: false };
}
