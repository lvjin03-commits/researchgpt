import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";
import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "./checker.ts";
import { grantNodeText } from "./node-text.ts";

const LITERATURE_CLAIM = /(?:已有|既有|前人|国内外|相关|多项)?研究(?:结果)?(?:表明|发现|显示|指出|证实)|文献(?:报道|表明|指出)|已有报道|据报道/gu;
const VISIBLE_CITATION = /(?:[\[【]\s*\d+(?:\s*[-–—,，、]\s*\d+)*\s*[\]】]|[（(][^（）()]{0,80}(?:19|20)\d{2}[a-z]?[^（）()]{0,30}[）)]|\bdoi\s*[:：]?\s*10\.\d{4,9}\/\S+)/iu;
const OWN_WORK_CONTEXT = /(?:本研究|本项目|本课题|申请人|前期(?:研究|工作|结果|基础)?)[^。！？!?]{0,12}$/u;

type TextRange = { text: string; start: number; end: number };

function sentences(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const pattern = /[^。！？!?；;\n]+[。！？!?；;]?/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[0].trim();
    if (!value) continue;
    const rawStart = match.index ?? 0;
    const leading = match[0].indexOf(value);
    ranges.push({ text: value, start: rawStart + Math.max(0, leading), end: rawStart + Math.max(0, leading) + value.length });
  }
  return ranges;
}

function adjacentCitationNode(snapshot: CanonicalGrantSnapshot, nodeId: string): boolean {
  const node = snapshot.nodes.find((candidate) => candidate.nodeId === nodeId);
  const section = node ? snapshot.sections.find((candidate) => candidate.sectionId === node.sectionId) : undefined;
  if (!node || !section) return false;
  const index = section.nodeIds.indexOf(nodeId);
  const nextId = index >= 0 ? section.nodeIds[index + 1] : undefined;
  return Boolean(nextId && snapshot.nodes.find((candidate) => candidate.nodeId === nextId)?.nodeType === "citation");
}

export class GrantCitationSupportChecker implements GrantChecker {
  readonly checkerId = "grant.citation_support";
  readonly checkerVersion = "1.0.0";
  readonly contractVersion = "grant-checker-v1";
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;

  async check(input: GrantCheckerInput) {
    const findings: GrantCheckerFindingCandidate[] = [];
    const allowedNodeIds = new Set(input.inputNodeIds);
    const sectionById = new Map(input.snapshot.sections.map((section) => [section.sectionId, section]));
    for (const node of input.snapshot.nodes) {
      if (!allowedNodeIds.has(node.nodeId) || !["paragraph", "list"].includes(node.nodeType)) continue;
      const section = sectionById.get(node.sectionId);
      if (!section || section.semanticRole === "references" || /参考文献/.test(section.title)) continue;
      const text = grantNodeText(node);
      if (adjacentCitationNode(input.snapshot, node.nodeId)) continue;
      for (const sentence of sentences(text)) {
        LITERATURE_CLAIM.lastIndex = 0;
        const claim = LITERATURE_CLAIM.exec(sentence.text);
        if (!claim || VISIBLE_CITATION.test(sentence.text)) continue;
        const prefix = sentence.text.slice(0, claim.index);
        if (OWN_WORK_CONTEXT.test(prefix)) continue;
        findings.push({
          code: "literature_claim_without_citation",
          message: "该句引用了已有研究或文献结论，但句内未找到可见的来源标记。",
          recommendation: "核对原始文献，在这条具体陈述后补充真实引用；如果这是申请人的前期结果，请明确写成前期工作并指向相应材料。",
          assessment: { scope: "sentence", confidence: 0.98, actionability: "requires_evidence" },
          subjectKey: `node:${node.nodeId}:literature_claim:${sentence.start}`,
          conclusion: "citation_missing",
          sectionId: node.sectionId,
          nodeId: node.nodeId,
          startOffset: sentence.start,
          endOffset: sentence.end,
        });
      }
    }
    return { findings, metadata: { checkedNodeCount: allowedNodeIds.size } };
  }
}
