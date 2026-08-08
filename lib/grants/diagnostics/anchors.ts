import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import {
  GrantAnchorResolutionSchema,
  GrantSourceAnchorSchema,
  type GrantAnchorResolution,
  type GrantSourceAnchor,
} from "./contracts.ts";
import { grantNodeText } from "./node-text.ts";

function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function ngrams(value: string, size = 2): Set<string> {
  const normalized = normalizeText(value);
  if (!normalized) return new Set();
  if (normalized.length < size) return new Set([normalized]);
  return new Set(Array.from({ length: normalized.length - size + 1 }, (_, index) => normalized.slice(index, index + size)));
}

function overlap(left: string, right: string): number {
  const leftParts = ngrams(left);
  const rightParts = ngrams(right);
  if (leftParts.size === 0 || rightParts.size === 0) return 0;
  const intersection = [...leftParts].filter((value) => rightParts.has(value)).length;
  return intersection / new Set([...leftParts, ...rightParts]).size;
}

function sectionForNode(snapshot: CanonicalGrantSnapshot, sectionId: string) {
  return snapshot.sections.find((section) => section.sectionId === sectionId);
}

function nodeContext(snapshot: CanonicalGrantSnapshot, nodeId: string) {
  const node = snapshot.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) return null;
  const section = sectionForNode(snapshot, node.sectionId);
  if (!section) return null;
  const orderedNodes = section.nodeIds
    .map((id) => snapshot.nodes.find((candidate) => candidate.nodeId === id))
    .filter(Boolean) as CanonicalGrantSnapshot["nodes"];
  const index = orderedNodes.findIndex((candidate) => candidate.nodeId === nodeId);
  return {
    node,
    section,
    text: grantNodeText(node),
    previousText: index > 0 ? grantNodeText(orderedNodes[index - 1]!) : "",
    nextText: index >= 0 && index < orderedNodes.length - 1 ? grantNodeText(orderedNodes[index + 1]!) : "",
  };
}

export function createGrantSourceAnchor(input: {
  snapshot: CanonicalGrantSnapshot;
  sourceRevisionId: string;
  sectionId?: string;
  nodeId?: string;
  startOffset?: number;
  endOffset?: number;
}): GrantSourceAnchor {
  if (!input.nodeId) {
    const section = input.sectionId ? sectionForNode(input.snapshot, input.sectionId) : undefined;
    return GrantSourceAnchorSchema.parse({
      sourceRevisionId: input.sourceRevisionId,
      locationStatus: "unlocated",
      sectionId: section?.sectionId,
      sectionRole: section?.semanticRole ?? "",
      heading: section?.title ?? "",
      text: "",
      textHash: sha256Canonical(""),
      previousText: "",
      nextText: "",
      unlocatedReason: section ? "Finding applies to a section without a source node." : "Checker did not provide a source node.",
    });
  }
  const context = nodeContext(input.snapshot, input.nodeId);
  if (!context) {
    return GrantSourceAnchorSchema.parse({
      sourceRevisionId: input.sourceRevisionId,
      locationStatus: "unlocated",
      sectionRole: "",
      heading: "",
      text: "",
      textHash: sha256Canonical(""),
      previousText: "",
      nextText: "",
      unlocatedReason: "Checker source node does not exist in the source revision.",
    });
  }
  const startOffset = input.startOffset ?? 0;
  const endOffset = input.endOffset ?? context.text.length;
  const selectedText = context.text.slice(startOffset, endOffset);
  return GrantSourceAnchorSchema.parse({
    sourceRevisionId: input.sourceRevisionId,
    locationStatus: "located",
    sectionId: context.section.sectionId,
    nodeId: context.node.nodeId,
    nodeType: context.node.nodeType,
    sectionRole: context.section.semanticRole,
    heading: context.section.title,
    text: selectedText,
    textHash: sha256Canonical(selectedText),
    previousText: context.previousText,
    nextText: context.nextText,
    startOffset,
    endOffset,
  });
}

function candidateScore(anchor: GrantSourceAnchor, snapshot: CanonicalGrantSnapshot, nodeId: string): number {
  const context = nodeContext(snapshot, nodeId);
  if (!context) return 0;
  let score = 0.6 * overlap(anchor.text, context.text);
  score += 0.12 * overlap(anchor.heading, context.section.title);
  score += 0.12 * Number(anchor.sectionRole === context.section.semanticRole);
  score += 0.08 * overlap(anchor.previousText, context.previousText);
  score += 0.08 * overlap(anchor.nextText, context.nextText);
  if (anchor.nodeType !== context.node.nodeType) score -= 0.2;
  return Math.max(0, Math.round(score * 10_000) / 10_000);
}

export function resolveGrantSourceAnchor(
  anchor: GrantSourceAnchor,
  targetRevisionId: string,
  targetSnapshot: CanonicalGrantSnapshot,
): GrantAnchorResolution {
  if (anchor.locationStatus === "unlocated") {
    return GrantAnchorResolutionSchema.parse({
      status: "unable_to_match",
      targetRevisionId,
      score: 0,
      margin: 0,
      candidates: [],
      reason: anchor.unlocatedReason ?? "Source Finding was not located.",
    });
  }
  const stableContext = anchor.nodeId ? nodeContext(targetSnapshot, anchor.nodeId) : null;
  if (
    stableContext &&
    stableContext.node.nodeType === anchor.nodeType &&
    stableContext.section.semanticRole === anchor.sectionRole
  ) {
    const selectedText = stableContext.text.slice(anchor.startOffset ?? 0, anchor.endOffset ?? stableContext.text.length);
    if (sha256Canonical(selectedText) === anchor.textHash) {
      return GrantAnchorResolutionSchema.parse({
        status: "exact",
        targetRevisionId,
        targetNodeId: stableContext.node.nodeId,
        score: 1,
        margin: 1,
        candidates: [{ nodeId: stableContext.node.nodeId, score: 1 }],
        reason: "Stable node identity and selected text hash match.",
      });
    }
  }
  const ranked = targetSnapshot.nodes
    .map((node) => ({ nodeId: node.nodeId, score: candidateScore(anchor, targetSnapshot, node.nodeId) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const best = ranked[0];
  const runnerUp = ranked[1]?.score ?? 0;
  const margin = Math.max(0, Math.round(((best?.score ?? 0) - runnerUp) * 10_000) / 10_000);
  const status = best && best.score >= 0.82 && margin >= 0.12
    ? "relocated"
    : best && best.score >= 0.58
      ? "ambiguous"
      : "unable_to_match";
  return GrantAnchorResolutionSchema.parse({
    status,
    targetRevisionId,
    targetNodeId: status === "relocated" ? best?.nodeId : undefined,
    score: best?.score ?? 0,
    margin,
    candidates: ranked,
    reason: status === "relocated"
      ? "A unique high-confidence structural and textual match was found."
      : status === "ambiguous"
        ? "Candidate similarity is insufficiently distinct for automatic relocation."
        : "No candidate satisfies the conservative relocation threshold.",
  });
}
