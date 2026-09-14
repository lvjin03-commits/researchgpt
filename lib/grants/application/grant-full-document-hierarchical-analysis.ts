import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantFullDocumentAnalysisModel, GrantFullDocumentAnalysisAnswer,
  GrantFullDocumentUnitAnalysis } from "../ports/grant-full-document-analysis-model.ts";
import type { GrantTokenCounter } from "../ports/grant-token-counter.ts";
import type { GrantFullDocumentCapacityRoute } from "./grant-full-document-capacity-router.ts";
import type { GrantFullDocumentContext, GrantFullDocumentContextNode,
  GrantFullDocumentContextSection } from "./grant-full-document-context.ts";

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
};

export class GrantFullDocumentAnalysisError extends Error {
  readonly code: "context_mismatch" | "unit_capacity_exceeded" | "invalid_source_reference" |
    "incomplete_coverage" | "synthesis_capacity_exceeded";
  constructor(code: GrantFullDocumentAnalysisError["code"], message: string) {
    super(message);
    this.name = "GrantFullDocumentAnalysisError";
    this.code = code;
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
  synthesisMaximumInputTokens: number;
}): Promise<GrantFullDocumentHierarchicalAnalysisResult> {
  if (!input.question.trim()) throw new Error("A full-document analysis question is required.");
  if (!Number.isSafeInteger(input.synthesisMaximumInputTokens) || input.synthesisMaximumInputTokens <= 0) {
    throw new Error("Synthesis maximum input tokens must be a positive integer.");
  }
  const units = buildGrantFullDocumentAnalysisUnits(input);
  const documentLanguage = /[\u3400-\u9fff]/u.test(input.context.title + input.question) ? "zh" : "en";
  const analyzed = [] as GrantFullDocumentHierarchicalAnalysisResult["units"];
  for (const unit of units) {
    const analysis = await input.model.analyzeUnit({ documentLanguage, question: input.question,
      contextHash: input.context.contextHash, unitId: unit.unitId, modelText: unit.modelText,
      allowedSourceAliases: unit.sourceAliases });
    const allowed = new Set(unit.sourceAliases);
    validateUnitAnalysis(analysis, allowed);
    analyzed.push({ ...unit, analysis });
  }
  const synthesisPayload = { question: input.question, contextHash: input.context.contextHash,
    analyses: analyzed.map(({ unitId, analysis }) => ({ unitId, ...analysis })) };
  if (input.tokenCounter.count(JSON.stringify(synthesisPayload)) > input.synthesisMaximumInputTokens) {
    throw new GrantFullDocumentAnalysisError("synthesis_capacity_exceeded",
      "Complete unit analyses exceed the synthesis input budget; a reduction stage is required.");
  }
  const allAliases = new Set(input.context.nodes.map((node) => node.sourceAlias));
  const answer = await input.model.synthesize({ documentLanguage, question: input.question,
    contextHash: input.context.contextHash, analyses: synthesisPayload.analyses,
    allowedSourceAliases: [...allAliases] });
  if (!answer.content.trim() || answer.claims.some((claim) => !claim.statement.trim())) {
    throw new GrantFullDocumentAnalysisError("invalid_source_reference", "Model synthesis returned empty required content.");
  }
  answer.claims.forEach((claim) => validateReferences(claim.sourceAliases, allAliases));
  const coveredSectionAliases = [...new Set(analyzed.flatMap((unit) => unit.sectionAliases))];
  const coveredSourceAliases = [...new Set(analyzed.flatMap((unit) => unit.sourceAliases))];
  return { schemaVersion: "grant-full-document-hierarchical-analysis-v1", documentId: input.context.documentId,
    sourceRevisionId: input.context.sourceRevisionId, contextHash: input.context.contextHash,
    executionHash: sha256Canonical({ contextHash: input.context.contextHash, question: input.question,
      units: analyzed, answer }), answer, units: analyzed,
    coverage: { sectionAliases: coveredSectionAliases, sourceAliases: coveredSourceAliases, complete: true } };
}
