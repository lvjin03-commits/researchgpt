import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantFullDocumentAnalysisModel, GrantFullDocumentAnalysisAnswer,
  GrantFullDocumentUnitAnalysis } from "../ports/grant-full-document-analysis-model.ts";
import type { GrantFullDocumentSynthesisRequest,
  GrantFullDocumentUnitRequest } from "../assistant/grant-full-document-review-request.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import { GrantAssistantModelError } from "../ports/grant-assistant-model.ts";
import type { GrantFullDocumentCapacityRoute } from "./grant-full-document-capacity-router.ts";
import type { GrantFullDocumentContext, GrantFullDocumentContextNode,
  GrantFullDocumentContextSection } from "./grant-full-document-context.ts";
import { createGrantAssistantFailureReason, GrantAssistantFailureReasonSchema,
  type GrantAssistantFailureReason, type GrantAssistantFailureReasonCode,
  type GrantAssistantFailureStage } from "../model-execution/assistant-failure-reasons.ts";

type HierarchicalRoute = Extract<GrantFullDocumentCapacityRoute, { mode: "hierarchical" }>;

export type GrantFullDocumentAnalysisUnit = {
  unitId: string;
  sectionAliases: string[];
  sourceAliases: string[];
  modelText: string;
  tokenCount: number;
};

export type GrantFullDocumentHierarchicalAnalysisResult = {
  schemaVersion: "grant-full-document-hierarchical-analysis-v1";
  documentId: string;
  sourceRevisionId: string;
  contextHash: string;
  executionHash: string;
  answer: GrantFullDocumentAnalysisAnswer;
  units: Array<GrantFullDocumentAnalysisUnit & { analysis: GrantFullDocumentUnitAnalysis }>;
  coverage: { sectionAliases: string[]; sourceAliases: string[]; complete: true };
  providerRequestIds: string[];
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
  provider: "openai";
  modelId: string;
};

export class GrantFullDocumentAnalysisError extends Error {
  readonly code: "context_mismatch" | "unit_capacity_exceeded" | "invalid_source_reference" |
    "incomplete_coverage" | "synthesis_capacity_exceeded";
  readonly failureReason: GrantAssistantFailureReason;
  readonly failureStage: GrantAssistantFailureStage;
  readonly requestDispatched = false;
  readonly usageKnown = true;
  constructor(code: GrantFullDocumentAnalysisError["code"], message: string, attribution?: {
    reasonCode: GrantAssistantFailureReasonCode; stage: GrantAssistantFailureStage;
    safeFacts?: Parameters<typeof createGrantAssistantFailureReason>[0]["safeFacts"];
  }) {
    super(message);
    this.name = "GrantFullDocumentAnalysisError";
    this.code = code;
    const fallback = code === "context_mismatch"
      ? { reasonCode: "review.context_mismatch" as const, stage: "original_retrieval" as const }
      : code === "incomplete_coverage"
        ? { reasonCode: "review.coverage_incomplete" as const, stage: "original_retrieval" as const }
        : code === "unit_capacity_exceeded"
          ? { reasonCode: "budget.review_unit_required_context_exceeded" as const, stage: "context_admission" as const }
          : code === "synthesis_capacity_exceeded"
            ? { reasonCode: "budget.review_synthesis_required_context_exceeded" as const, stage: "context_admission" as const }
            : { reasonCode: "review.unit_output_invalid" as const, stage: "answer_generation" as const };
    const resolved: { reasonCode: GrantAssistantFailureReasonCode; stage: GrantAssistantFailureStage;
      safeFacts?: Parameters<typeof createGrantAssistantFailureReason>[0]["safeFacts"] } = attribution ?? fallback;
    this.failureStage = resolved.stage;
    this.failureReason = createGrantAssistantFailureReason({ reasonCode: resolved.reasonCode,
      stage: resolved.stage, safeFacts: { ...resolved.safeFacts, requestDispatched: false, usageKnown: true } });
  }
}

function nodeBlock(node: GrantFullDocumentContextNode, fragment?: { index: number; count: number; text: string }) {
  const suffix = fragment ? ` fragment ${fragment.index}/${fragment.count}` : "";
  return `[${node.sourceAlias}${suffix}] (${node.nodeType})\n${fragment?.text ?? node.text}`;
}

function splitTextToBudget(input: { text: string; prefix: string; budget: number; counter: GrantTokenCounter }) {
  const characters = Array.from(input.text);
  const pieces: string[] = [];
  let cursor = 0;
  while (cursor < characters.length) {
    let low = 1;
    let high = characters.length - cursor;
    let accepted = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${input.prefix}${characters.slice(cursor, cursor + middle).join("")}`;
      if (input.counter.count(candidate) <= input.budget) {
        accepted = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (accepted === 0) throw new GrantFullDocumentAnalysisError("unit_capacity_exceeded",
      "A document fragment cannot fit after fixed section metadata.");
    pieces.push(characters.slice(cursor, cursor + accepted).join(""));
    cursor += accepted;
  }
  return pieces;
}

function subdivideSection(input: { context: GrantFullDocumentContext; section: GrantFullDocumentContextSection;
  budget: number; counter: GrantTokenCounter }): GrantFullDocumentAnalysisUnit[] {
  const title = `申请书标题：${input.context.title}`;
  const heading = `${"#".repeat(Math.min(input.section.depth + 1, 6))} [${input.section.sectionAlias}] ${input.section.title}`;
  const envelope = `${title}\n\n${heading}\n\n`;
  if (input.counter.count(envelope) >= input.budget) throw new GrantFullDocumentAnalysisError(
    "unit_capacity_exceeded", `Section ${input.section.sectionAlias} metadata exceeds the document budget.`);
  const nodes = input.section.nodeAliases.map((alias) => input.context.nodes.find((node) => node.sourceAlias === alias)!);
  if (nodes.length === 0) return [{ unitId: `${input.section.sectionAlias}-U1`,
    sectionAliases: [input.section.sectionAlias], sourceAliases: [], modelText: envelope.trim(),
    tokenCount: input.counter.count(envelope.trim()) }];
  const atomic: Array<{ text: string; sourceAlias: string }> = [];
  for (const node of nodes) {
    const complete = `${envelope}${nodeBlock(node)}`;
    if (input.counter.count(complete) <= input.budget) {
      atomic.push({ text: nodeBlock(node), sourceAlias: node.sourceAlias });
      continue;
    }
    const prefix = `${envelope}[${node.sourceAlias} fragment 9999/9999] (${node.nodeType})\n`;
    const fragments = splitTextToBudget({ text: node.text, prefix, budget: input.budget, counter: input.counter });
    fragments.forEach((text, index) => atomic.push({
      text: nodeBlock(node, { index: index + 1, count: fragments.length, text }), sourceAlias: node.sourceAlias,
    }));
  }
  const units: GrantFullDocumentAnalysisUnit[] = [];
  let blocks: typeof atomic = [];
  const flush = () => {
    if (blocks.length === 0) return;
    const modelText = [title, heading, ...blocks.map((block) => block.text)].join("\n\n");
    units.push({ unitId: `${input.section.sectionAlias}-U${units.length + 1}`,
      sectionAliases: [input.section.sectionAlias], sourceAliases: [...new Set(blocks.map((block) => block.sourceAlias))],
      modelText, tokenCount: input.counter.count(modelText) });
    blocks = [];
  };
  for (const block of atomic) {
    const candidate = [title, heading, ...blocks.map((item) => item.text), block.text].join("\n\n");
    if (blocks.length > 0 && input.counter.count(candidate) > input.budget) flush();
    blocks.push(block);
  }
  flush();
  if (units.some((unit) => unit.tokenCount > input.budget)) throw new GrantFullDocumentAnalysisError(
    "unit_capacity_exceeded", `Section ${input.section.sectionAlias} subdivision exceeded the document budget.`);
  return units;
}

export function buildGrantFullDocumentAnalysisUnits(input: { context: GrantFullDocumentContext;
  route: HierarchicalRoute; tokenCounter: GrantTokenCounter }): GrantFullDocumentAnalysisUnit[] {
  if (input.route.contextHash !== input.context.contextHash || input.route.documentId !== input.context.documentId ||
    input.route.sourceRevisionId !== input.context.sourceRevisionId) throw new GrantFullDocumentAnalysisError(
    "context_mismatch", "The capacity route does not belong to this document Revision context.");
  const sectionByAlias = new Map(input.context.sections.map((section) => [section.sectionAlias, section]));
  const units: GrantFullDocumentAnalysisUnit[] = [];
  for (const chunk of input.route.chunks) {
    if (chunk.fitsInputBudget) {
      const sourceAliases = chunk.sectionAliases.flatMap((alias) => sectionByAlias.get(alias)?.nodeAliases ?? []);
      units.push({ unitId: `U${units.length + 1}`, sectionAliases: chunk.sectionAliases,
        sourceAliases, modelText: chunk.modelText, tokenCount: chunk.tokenCount });
      continue;
    }
    for (const alias of chunk.sectionAliases) {
      const section = sectionByAlias.get(alias);
      if (!section) throw new GrantFullDocumentAnalysisError("incomplete_coverage", `Unknown section alias ${alias}.`);
      units.push(...subdivideSection({ context: input.context, section,
        budget: input.route.capacity.availableDocumentTokens, counter: input.tokenCounter }));
    }
  }
  const sections = [...new Set(units.flatMap((unit) => unit.sectionAliases))];
  const sources = [...new Set(units.flatMap((unit) => unit.sourceAliases))];
  if (sections.length !== input.context.sections.length || sources.length !== input.context.nodes.length) {
    throw new GrantFullDocumentAnalysisError("incomplete_coverage", "Analysis units do not cover the complete document.");
  }
  return units;
}

function validateReferences(aliases: string[], allowed: ReadonlySet<string>) {
  if (aliases.length === 0 || aliases.some((alias) => !allowed.has(alias))) {
    throw new GrantFullDocumentAnalysisError("invalid_source_reference", "Model analysis referenced an unavailable source alias.");
  }
}

function validateUnitAnalysis(analysis: GrantFullDocumentUnitAnalysis, allowed: ReadonlySet<string>) {
  if (!analysis.summary.trim() || analysis.findings.some((finding) => !finding.statement.trim())) {
    throw new GrantFullDocumentAnalysisError("invalid_source_reference", "Model analysis returned empty required content.");
  }
  analysis.findings.forEach((finding) => validateReferences(finding.sourceAliases, allowed));
}

export async function executeGrantFullDocumentHierarchicalAnalysis(input: {
  context: GrantFullDocumentContext;
  route: HierarchicalRoute;
  tokenCounter: GrantTokenCounter;
  model: GrantFullDocumentAnalysisModel;
  question: string;
  unitMaximumOutputTokens: number;
  synthesisMaximumInputTokens: number;
  synthesisMaximumOutputTokens: number;
  maximumUnits: number;
  supplementalAnalyses?: GrantFullDocumentSynthesisRequest["analyses"];
  supplementalSourceAliases?: string[];
  beforeUnit?: (request: GrantFullDocumentUnitRequest) => void | Promise<void>;
  beforeSynthesis?: (request: GrantFullDocumentSynthesisRequest) => void | Promise<void>;
}): Promise<GrantFullDocumentHierarchicalAnalysisResult> {
  if (!input.question.trim()) throw new Error("A full-document analysis question is required.");
  if (!Number.isSafeInteger(input.synthesisMaximumInputTokens) || input.synthesisMaximumInputTokens <= 0) {
    throw new Error("Synthesis maximum input tokens must be a positive integer.");
  }
  if (![input.unitMaximumOutputTokens, input.synthesisMaximumOutputTokens, input.maximumUnits]
    .every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Full-document output and unit limits must be positive integers.");
  }
  const units = buildGrantFullDocumentAnalysisUnits(input);
  if (units.length > input.maximumUnits) throw new GrantFullDocumentAnalysisError(
    "unit_capacity_exceeded", `Full-document analysis requires ${units.length} units; maximum is ${input.maximumUnits}.`);
  const documentLanguage = /[\u3400-\u9fff]/u.test(input.context.title + input.question) ? "zh" : "en";
  const analyzed = [] as GrantFullDocumentHierarchicalAnalysisResult["units"];
  const providerRequestIds: string[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let usageKnown = true;
  const addMetadata = (result: { providerRequestId?: string; usage?: {
    inputTokens?: number; outputTokens?: number; reasoningTokens?: number } }) => {
    if (result.providerRequestId) providerRequestIds.push(result.providerRequestId);
    if (!result.usage) usageKnown = false;
    usage.inputTokens += result.usage?.inputTokens ?? 0;
    usage.outputTokens += result.usage?.outputTokens ?? 0;
    usage.reasoningTokens += result.usage?.reasoningTokens ?? 0;
  };
  const throwWithAggregateMetadata = (error: unknown): never => {
    if (!(error instanceof GrantAssistantModelError)) throw error;
    const requestIds = [...new Set([...providerRequestIds, ...error.providerRequestIds])];
    throw new GrantAssistantModelError(error.category, error.message, {
      providerRequestIds: requestIds,
      ...(requestIds.at(-1) ? { providerRequestId: requestIds.at(-1) } : {}),
      usage: { inputTokens: usage.inputTokens + (error.usage?.inputTokens ?? 0),
        outputTokens: usage.outputTokens + (error.usage?.outputTokens ?? 0),
        reasoningTokens: usage.reasoningTokens + (error.usage?.reasoningTokens ?? 0) },
      failureStage: error.failureStage ?? "answer_generation",
      failureReason: error.failureReason,
      requestDispatched: requestIds.length > 0 || error.requestDispatched,
      usageKnown: usageKnown && error.usageKnown,
    });
  };
  const throwAdmissionWithAggregateMetadata = (error: unknown): never => {
    if (providerRequestIds.length === 0) throw error;
    const candidate = error as { code?: unknown };
    const category = candidate?.code === "planning_capacity_exceeded"
      ? "planning_capacity_exceeded" : candidate?.code === "answer_capacity_exceeded"
        ? "answer_capacity_exceeded" : "internal_contract_error";
    const attributed = GrantAssistantFailureReasonSchema.safeParse((error as { failureReason?: unknown })?.failureReason);
    const failureReason = attributed.success ? attributed.data : createGrantAssistantFailureReason({
      reasonCode: category === "planning_capacity_exceeded"
        ? "budget.planning_required_context_exceeded" : category === "answer_capacity_exceeded"
          ? "budget.review_unit_required_context_exceeded" : "executor.unclassified_failure",
      stage: "context_admission", safeFacts: { requestDispatched: true, usageKnown } });
    throw new GrantAssistantModelError(failureReason.category,
      error instanceof Error ? error.message : "Full-document context admission failed.", {
        providerRequestIds: [...providerRequestIds], usage: { ...usage },
        failureStage: "context_admission", failureReason, requestDispatched: true, usageKnown });
  };
  for (const unit of units) {
    const request: GrantFullDocumentUnitRequest = { documentLanguage, question: input.question,
      contextHash: input.context.contextHash, unitId: unit.unitId, modelText: unit.modelText,
      allowedSourceAliases: unit.sourceAliases, maximumOutputTokens: input.unitMaximumOutputTokens };
    try {
      await input.beforeUnit?.(request);
    } catch (error) {
      throwAdmissionWithAggregateMetadata(error);
    }
    const analysis: GrantFullDocumentUnitAnalysis = await input.model.analyzeUnit(request)
      .catch((error: unknown) => throwWithAggregateMetadata(error));
    const allowed = new Set(unit.sourceAliases);
    addMetadata(analysis);
    try {
      validateUnitAnalysis(analysis, allowed);
    } catch (error) {
      throw new GrantAssistantModelError("structured_output_invalid",
        error instanceof Error ? error.message : "Full-document unit analysis is invalid.", {
          providerRequestIds: [...providerRequestIds], usage: { ...usage },
          failureStage: "answer_generation",
          failureReason: createGrantAssistantFailureReason({ reasonCode: "review.unit_output_invalid",
            stage: "answer_generation", safeFacts: { completedUnitCount: analyzed.length,
              totalUnitCount: units.length, requestDispatched: providerRequestIds.length > 0, usageKnown } }),
          requestDispatched: providerRequestIds.length > 0, usageKnown });
    }
    analyzed.push({ ...unit, analysis });
  }
  const supplementalAliases = input.supplementalSourceAliases ?? [];
  const documentAliases = input.context.nodes.map((node) => node.sourceAlias);
  try {
    if (new Set([...documentAliases, ...supplementalAliases]).size !== documentAliases.length + supplementalAliases.length) {
      throw new GrantFullDocumentAnalysisError("invalid_source_reference", "Supplemental aliases overlap document aliases.");
    }
    const supplementalAllowed = new Set(supplementalAliases);
    for (const analysis of input.supplementalAnalyses ?? []) {
      if (!analysis.summary.trim()) throw new GrantFullDocumentAnalysisError(
        "invalid_source_reference", "Supplemental analysis returned empty required content.");
      analysis.findings.forEach((finding) => validateReferences(finding.sourceAliases, supplementalAllowed));
    }
  } catch (error) {
    throw new GrantAssistantModelError("internal_contract_error",
      error instanceof Error ? error.message : "Supplemental full-document context is invalid.", {
        providerRequestIds: [...providerRequestIds], usage: { ...usage },
        failureStage: "answer_generation",
        failureReason: createGrantAssistantFailureReason({ reasonCode: "review.coverage_incomplete",
          stage: "answer_generation", safeFacts: { completedUnitCount: analyzed.length,
            totalUnitCount: units.length, requestDispatched: providerRequestIds.length > 0, usageKnown } }),
        requestDispatched: providerRequestIds.length > 0, usageKnown });
  }
  const synthesisPayload = { question: input.question, contextHash: input.context.contextHash,
    analyses: analyzed.map(({ unitId, analysis }) => ({ unitId, summary: analysis.summary,
      findings: analysis.findings })).concat(input.supplementalAnalyses ?? []) };
  if (input.tokenCounter.count(JSON.stringify(synthesisPayload)) > input.synthesisMaximumInputTokens) {
    throw new GrantAssistantModelError("answer_capacity_exceeded",
      "Complete unit analyses exceed the synthesis input budget; a reduction stage is required.", {
        providerRequestIds: [...providerRequestIds], usage: { ...usage },
        failureStage: "context_admission",
        failureReason: createGrantAssistantFailureReason({ reasonCode: "budget.review_synthesis_required_context_exceeded",
          stage: "context_admission", safeFacts: {
            maximumInputTokens: input.synthesisMaximumInputTokens,
            requiredInputTokens: input.tokenCounter.count(JSON.stringify(synthesisPayload)),
            requestDispatched: providerRequestIds.length > 0, usageKnown } }),
        requestDispatched: providerRequestIds.length > 0, usageKnown });
  }
  const allAliases = new Set([...documentAliases, ...supplementalAliases]);
  const synthesisRequest: GrantFullDocumentSynthesisRequest = { documentLanguage, question: input.question,
    contextHash: input.context.contextHash, analyses: synthesisPayload.analyses,
    allowedSourceAliases: [...allAliases], maximumOutputTokens: input.synthesisMaximumOutputTokens };
  try {
    await input.beforeSynthesis?.(synthesisRequest);
  } catch (error) {
    throwAdmissionWithAggregateMetadata(error);
  }
  const answer: GrantFullDocumentAnalysisAnswer = await input.model.synthesize(synthesisRequest)
    .catch((error: unknown) => throwWithAggregateMetadata(error));
  addMetadata(answer);
  let modelIds: Set<string>;
  try {
    if (!answer.content.trim() || answer.claims.some((claim) => !claim.statement.trim())) {
      throw new GrantFullDocumentAnalysisError("invalid_source_reference", "Model synthesis returned empty required content.");
    }
    modelIds = new Set([...analyzed.map((unit) => unit.analysis.modelId), answer.modelId]
      .filter((value): value is string => Boolean(value)));
    if (answer.provider !== "openai" || analyzed.some((unit) => unit.analysis.provider !== "openai") || modelIds.size !== 1) {
      throw new GrantFullDocumentAnalysisError("invalid_source_reference",
        "Hierarchical analysis model identity is inconsistent.", {
          reasonCode: "review.model_identity_mismatch", stage: "answer_generation" });
    }
    answer.claims.forEach((claim) => validateReferences(claim.sourceAliases, allAliases));
  } catch (error) {
    const attributed = GrantAssistantFailureReasonSchema.safeParse((error as { failureReason?: unknown })?.failureReason);
    const failureReason = attributed.success ? attributed.data : createGrantAssistantFailureReason({
      reasonCode: "review.synthesis_output_invalid", stage: "answer_generation",
      safeFacts: { completedUnitCount: analyzed.length, totalUnitCount: units.length,
        requestDispatched: providerRequestIds.length > 0, usageKnown } });
    throw new GrantAssistantModelError(failureReason.category,
      error instanceof Error ? error.message : "Full-document synthesis is invalid.", {
        providerRequestIds: [...providerRequestIds], usage: { ...usage },
        failureStage: "answer_generation", failureReason,
        requestDispatched: providerRequestIds.length > 0, usageKnown });
  }
  const coveredSectionAliases = [...new Set(analyzed.flatMap((unit) => unit.sectionAliases))];
  const coveredSourceAliases = [...new Set(analyzed.flatMap((unit) => unit.sourceAliases))];
  return { schemaVersion: "grant-full-document-hierarchical-analysis-v1", documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId, contextHash: input.context.contextHash,
    executionHash: sha256Canonical({ contextHash: input.context.contextHash, question: input.question,
      units: analyzed.map(({ unitId, sectionAliases, sourceAliases, modelText, analysis }) => ({
        unitId, sectionAliases, sourceAliases, modelText, summary: analysis.summary, findings: analysis.findings })),
      supplementalAnalyses: input.supplementalAnalyses ?? [],
      answer: { content: answer.content, claims: answer.claims } }), answer, units: analyzed,
    coverage: { sectionAliases: coveredSectionAliases, sourceAliases: coveredSourceAliases, complete: true },
    providerRequestIds, usage, provider: "openai", modelId: [...modelIds][0]! };
}
