import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "./checker.ts";
import { grantNodeText } from "./node-text.ts";

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

function ngrams(value: string, size = 3): Set<string> {
  if (value.length < size) return new Set([value]);
  return new Set(Array.from({ length: value.length - size + 1 }, (_, index) => value.slice(index, index + size)));
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length);
  if (ratio < 0.9) return 0;
  const leftParts = ngrams(left);
  const rightParts = ngrams(right);
  const intersection = [...leftParts].filter((part) => rightParts.has(part)).length;
  return intersection / new Set([...leftParts, ...rightParts]).size;
}

function readableNodes(snapshot: CanonicalGrantSnapshot) {
  const sectionOrder = new Map(snapshot.sections.map((section, index) => [section.sectionId, index]));
  return snapshot.nodes
    .filter((node) => node.nodeType === "paragraph" || node.nodeType === "list")
    .map((node) => ({ node, text: grantNodeText(node), normalized: normalize(grantNodeText(node)) }))
    .filter((item) => item.normalized.length >= 40)
    .sort((left, right) => (sectionOrder.get(left.node.sectionId) ?? 0) - (sectionOrder.get(right.node.sectionId) ?? 0)
      || left.node.order - right.node.order);
}

export class GrantRepeatedContentChecker implements GrantChecker {
  readonly checkerId = "grant.repeated_content";
  readonly checkerVersion = "1.0.0";
  readonly contractVersion = "grant-checker-v1";
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;

  async check(input: GrantCheckerInput) {
    const findings: GrantCheckerFindingCandidate[] = [];
    const allowedNodeIds = new Set(input.inputNodeIds);
    const nodes = readableNodes(input.snapshot);
    const sectionById = new Map(input.snapshot.sections.map((section) => [section.sectionId, section]));
    const emittedPairs = new Set<string>();
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        if (!allowedNodeIds.has(left.node.nodeId) && !allowedNodeIds.has(right.node.nodeId)) continue;
        if (similarity(left.normalized, right.normalized) < 0.9) continue;
        const pair = [left.node.nodeId, right.node.nodeId].sort().join(":");
        if (emittedPairs.has(pair)) continue;
        emittedPairs.add(pair);
        const anchor = allowedNodeIds.has(right.node.nodeId) ? right : left;
        const other = anchor.node.nodeId === left.node.nodeId ? right : left;
        const otherSection = sectionById.get(other.node.sectionId);
        findings.push({
          code: "repeated_content",
          message: `该段与“${otherSection?.title ?? "另一章节"}”中的一段内容高度重复。`,
          recommendation: "明确两处各自承担的论证职责，保留一次完整论述；另一处改为承接、比较或引用，避免重复占用篇幅。",
          assessment: { scope: anchor.node.sectionId === other.node.sectionId ? "section" : "cross_section", confidence: 0.99, actionability: "directly_actionable" },
          subjectKey: `node_pair:${pair}:content_uniqueness`,
          conclusion: "repeated",
          sectionId: anchor.node.sectionId,
          nodeId: anchor.node.nodeId,
          startOffset: 0,
          endOffset: anchor.text.length,
        });
      }
    }
    return { findings, metadata: { comparedNodeCount: nodes.length, duplicatePairCount: findings.length } };
  }
}
