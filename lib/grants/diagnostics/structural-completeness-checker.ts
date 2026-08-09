import type { GrantChecker, GrantCheckerFindingCandidate, GrantCheckerInput } from "./checker.ts";
import { grantNodeText } from "./node-text.ts";

const PLACEHOLDER_PATTERNS = [
  /^\s*(?:请输入正文|待补充|待完善|暂无内容|TODO|TBD)\s*[。.!！]?\s*$/iu,
  /^\s*[【\[]\s*(?:待补充|待完善|TODO|TBD)\s*[】\]]\s*$/iu,
];

export class GrantStructuralCompletenessChecker implements GrantChecker {
  readonly checkerId = "grant.structural_completeness";
  readonly checkerVersion = "1.0.0";
  readonly contractVersion = "grant-checker-v1";
  readonly inputMode = "full_document" as const;
  readonly supportedInputModes = ["full_document", "section_bundle"] as const;

  async check(input: GrantCheckerInput) {
    const findings: GrantCheckerFindingCandidate[] = [];
    const allowedNodeIds = new Set(input.inputNodeIds);
    const allowedSectionIds = new Set(input.inputSectionIds);
    for (const section of input.snapshot.sections) {
      if (!allowedSectionIds.has(section.sectionId)) continue;
      const nodeIds = section.nodeIds.filter((nodeId) => allowedNodeIds.has(nodeId));
      if (nodeIds.length === 0) {
        findings.push({
          code: "empty_section",
          message: `章节“${section.title}”尚无正文内容。`,
          recommendation: "补充与本章节职责直接相关的论证内容，或确认该章节是否应保留。",
          assessment: { scope: "section", confidence: 1, actionability: "directly_actionable" },
          subjectKey: `section:${section.sectionId}:content_presence`,
          conclusion: "missing",
          sectionId: section.sectionId,
        });
      }
    }
    for (const node of input.snapshot.nodes) {
      if (!allowedNodeIds.has(node.nodeId)) continue;
      const text = grantNodeText(node);
      if (!PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) continue;
      findings.push({
        code: "placeholder_content",
        message: "该位置仍包含占位内容，尚未形成可评审的正式文本。",
        recommendation: "用能够表达具体事实、逻辑或研究安排的成熟文本替换占位内容。",
        assessment: { scope: node.nodeType === "heading" ? "section" : "paragraph", confidence: 1, actionability: "directly_actionable" },
        subjectKey: `node:${node.nodeId}:content_maturity`,
        conclusion: "placeholder",
        sectionId: node.sectionId,
        nodeId: node.nodeId,
        startOffset: 0,
        endOffset: text.length,
      });
    }
    return { findings, metadata: { checkedNodeCount: allowedNodeIds.size } };
  }
}
