import assert from "node:assert/strict";
import { createDefaultGrantCheckers } from "../lib/grants/diagnostics/default-checkers.ts";
import { CanonicalGrantSnapshotSchema, type CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";

const sectionIds = {
  basis: "81000000-0000-4000-8000-000000000001",
  objectives: "81000000-0000-4000-8000-000000000002",
  innovation: "81000000-0000-4000-8000-000000000003",
};
const nodeId = (value: number) => `82000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const repeated = "本项目拟建立多尺度动力学分析框架，系统比较关键变量对网络结构、界面行为及最终性能的影响，并通过独立实验验证模型预测。";
const snapshot: CanonicalGrantSnapshot = CanonicalGrantSnapshotSchema.parse({
  schemaVersion: "grant-canonical-v1",
  title: "真实诊断检查器回归样稿",
  sections: [
    { sectionId: sectionIds.basis, semanticRole: "rationale", title: "（一）立项依据", order: 0, nodeIds: [nodeId(1), nodeId(2), nodeId(3), nodeId(4)] },
    { sectionId: sectionIds.objectives, semanticRole: "objectives", title: "（二）研究目标", order: 1, nodeIds: [nodeId(5), nodeId(6), nodeId(7)] },
    { sectionId: sectionIds.innovation, semanticRole: "innovation", title: "（三）创新点", order: 2, nodeIds: [nodeId(8)] },
  ],
  nodes: [
    { nodeId: nodeId(1), sectionId: sectionIds.basis, order: 0, nodeType: "paragraph", content: { text: "已有研究表明，多尺度网络重排会显著影响材料的界面稳定性与宏观力学响应。" } },
    { nodeId: nodeId(2), sectionId: sectionIds.basis, order: 1, nodeType: "paragraph", content: { text: "已有研究指出，动态键交换能够提高材料韧性[1]。" } },
    { nodeId: nodeId(3), sectionId: sectionIds.basis, order: 2, nodeType: "paragraph", content: { text: "本项目采用人工智能（AI）辅助识别关键结构参数，并结合原位实验开展验证。" } },
    { nodeId: nodeId(4), sectionId: sectionIds.basis, order: 3, nodeType: "paragraph", content: { text: repeated } },
    { nodeId: nodeId(5), sectionId: sectionIds.objectives, order: 0, nodeType: "paragraph", content: { text: "研究目标包括构建增强智能（AI）预测模型，明确模型适用条件和可解释边界。" } },
    { nodeId: nodeId(6), sectionId: sectionIds.objectives, order: 1, nodeType: "paragraph", content: { text: repeated } },
    { nodeId: nodeId(7), sectionId: sectionIds.objectives, order: 2, nodeType: "paragraph", content: { text: "前期研究表明，本团队已经完成方法可行性验证。" } },
    { nodeId: nodeId(8), sectionId: sectionIds.innovation, order: 0, nodeType: "paragraph", content: { text: "提升性能。" } },
  ],
});

const checkers = createDefaultGrantCheckers();
assert.deepEqual(checkers.map((checker) => checker.checkerId), [
  "grant.structural_completeness",
  "grant.citation_support",
  "grant.repeated_content",
  "grant.terminology_consistency",
]);
const findings = (await Promise.all(checkers.map((checker) => checker.check({
  documentId: "83000000-0000-4000-8000-000000000001",
  revisionId: "83000000-0000-4000-8000-000000000002",
  snapshot,
  inputMode: "full_document",
  inputNodeIds: snapshot.nodes.map((node) => node.nodeId),
  inputSectionIds: snapshot.sections.map((section) => section.sectionId),
})))).flatMap((output) => output.findings);

assert.equal(findings.filter((finding) => finding.code === "insufficient_section_content").length, 1);
assert.equal(findings.filter((finding) => finding.code === "literature_claim_without_citation").length, 1);
assert.equal(findings.filter((finding) => finding.code === "repeated_content").length, 1);
assert.equal(findings.filter((finding) => finding.code === "acronym_definition_inconsistent").length, 1);
assert.match(findings.find((finding) => finding.code === "acronym_definition_inconsistent")?.message ?? "", /人工智能.*增强智能/);
assert.equal(findings.some((finding) => /严重|高风险|低风险/.test(finding.message)), false);
assert.equal(findings.every((finding) => finding.recommendation.trim().length > 0), true);
assert.equal(findings.every((finding) => finding.nodeId || finding.sectionId), true);

const incremental = await Promise.all(checkers.map((checker) => checker.check({
  documentId: "83000000-0000-4000-8000-000000000001",
  revisionId: "83000000-0000-4000-8000-000000000002",
  snapshot,
  inputMode: "section_bundle",
  inputNodeIds: [nodeId(5), nodeId(6), nodeId(7)],
  inputSectionIds: [sectionIds.objectives],
})));
assert.equal(incremental.every((output) => output.findings.every((finding) => !finding.sectionId || finding.sectionId === sectionIds.objectives)), true);

console.log("Grant real diagnostic checker contracts passed.");
