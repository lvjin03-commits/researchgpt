import { CanonicalGrantSnapshotSchema, type CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantPatchOperation, GrantPatchProposal } from "./contracts.ts";

export class GrantPatchPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "GrantPatchPolicyError";
  }
}

export function grantEditableNodeText(snapshot: CanonicalGrantSnapshot, nodeId: string): string {
  const node = snapshot.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new GrantPatchPolicyError("grant_patch_target_missing", "The patch target no longer exists.");
  if (node.nodeType !== "heading" && node.nodeType !== "paragraph") {
    throw new GrantPatchPolicyError("grant_patch_target_unsupported", "PR5 supports heading and paragraph patches only.");
  }
  return node.content.text;
}

export function grantTextHash(text: string): string {
  return sha256Canonical(text);
}

function newlyIntroducedMatches(oldText: string, newText: string, pattern: RegExp): string[] {
  const before = new Set(oldText.match(pattern) ?? []);
  return [...new Set(newText.match(pattern) ?? [])].filter((value) => !before.has(value));
}

/** Deterministic fact-safety boundary for evidence-free AI replacement text.
 * It compares old/new text so existing measurements and claims can be retained,
 * while new factual markers require an authorized Evidence Card. */
export function validateGrantPatchFactSafety(input: {
  oldText: string;
  newText: string;
  hasAuthorizedEvidence: boolean;
}): void {
  const newCitationMarkers = newlyIntroducedMatches(
    input.oldText,
    input.newText,
    /(?:\[[0-9]{1,3}(?:\s*[-,]\s*[0-9]{1,3})*\]|（[0-9]{1,3}）|\([A-Z][A-Za-z-]+\s*,?\s*(?:19|20)\d{2}[a-z]?\))/g,
  );
  const newReferenceEntries = newlyIntroducedMatches(
    input.oldText,
    input.newText,
    /(?:^|\n)\s*(?:参考文献|References?)\s*[:：]?|(?:^|\n)\s*\[[0-9]{1,3}\]\s+[^\n]+/gim,
  );
  if (newCitationMarkers.length > 0 || newReferenceEntries.length > 0) {
    throw new GrantPatchPolicyError("grant_patch_new_reference_blocked", "AI 修改不能新增引用标记或参考文献条目。");
  }
  if (input.hasAuthorizedEvidence) return;

  const newNumericClaims = newlyIntroducedMatches(
    input.oldText,
    input.newText,
    /(?<![A-Za-z])(?:\d+(?:\.\d+)?\s*(?:%|％|h|小时|次|圈|mA\s*cm[-−–]?2|mAh\s*cm[-−–]?2|Wh\s*kg[-−–]?1|MPa|GPa|℃|°C|倍|天|年))/gi,
  );
  const factualAdditionPattern = /(?:结果(?:表明|显示|证实)|实验(?:表明|显示|证实)|数据显示|研究发现|前期(?:研究|实验|工作|成果)(?:表明|显示|证实|发现|已|成功)|申请人(?:已|成功|发现|证实|建立|制备))/g;
  const newFactualClaims = newlyIntroducedMatches(input.oldText, input.newText, factualAdditionPattern);
  if (newNumericClaims.length > 0) {
    throw new GrantPatchPolicyError("grant_patch_new_numeric_claim_blocked", "没有授权证据时，AI 修改不能新增数字型事实断言。");
  }
  if (newFactualClaims.length > 0) {
    throw new GrantPatchPolicyError("grant_patch_new_factual_claim_blocked", "没有授权证据时，AI 修改不能新增实验结果或前期成果。");
  }
}

export function validateGrantPatchOperation(
  snapshot: CanonicalGrantSnapshot,
  proposal: GrantPatchProposal,
): GrantPatchOperation {
  if (proposal.operations.length !== 1 || proposal.targetNodeIds.length !== 1) {
    throw new GrantPatchPolicyError("grant_patch_scope_invalid", "A proposal must target exactly one node.");
  }
  const operation = proposal.operations[0];
  const operationTarget = operation.type === "insert_after" ? operation.anchorNodeId : operation.nodeId;
  if (operationTarget !== proposal.targetNodeIds[0]) {
    throw new GrantPatchPolicyError("grant_patch_scope_invalid", "The model output exceeded the authorized target.");
  }
  const currentText = grantEditableNodeText(snapshot, operationTarget);
  const expectedHash = operation.type === "insert_after" ? operation.expectedAnchorTextHash : operation.expectedTextHash;
  const expectedTextMatches = operation.type === "insert_after"
    ? operation.anchorText === currentText
    : operation.type === "replace_text"
      ? operation.oldText === currentText
      : operation.startOffset < operation.endOffset
        && operation.endOffset <= currentText.length
        && currentText.slice(operation.startOffset, operation.endOffset) === operation.oldText;
  if (!expectedTextMatches || expectedHash !== grantTextHash(currentText)) {
    throw new GrantPatchPolicyError("grant_patch_stale", "The target text changed after this proposal was created.");
  }
  if (!operation.newText.trim() || (operation.type !== "insert_after" && operation.newText === operation.oldText)) {
    throw new GrantPatchPolicyError("grant_patch_empty_change", "The proposal does not contain a valid text change.");
  }
  validateGrantPatchFactSafety({
    oldText: operation.type === "insert_after" ? "" : operation.oldText,
    newText: operation.newText,
    hasAuthorizedEvidence: proposal.evidenceBindings.length > 0,
  });
  return operation;
}

export function applyGrantPatch(
  snapshot: CanonicalGrantSnapshot,
  proposal: GrantPatchProposal,
): CanonicalGrantSnapshot {
  const operation = validateGrantPatchOperation(snapshot, proposal);
  if (operation.type === "insert_after") {
    const anchor = snapshot.nodes.find((node) => node.nodeId === operation.anchorNodeId)!;
    const section = snapshot.sections.find((candidate) => candidate.sectionId === anchor.sectionId)!;
    const anchorIndex = section.nodeIds.indexOf(anchor.nodeId);
    const nextNodeIds = [...section.nodeIds];
    nextNodeIds.splice(anchorIndex + 1, 0, operation.newNodeId);
    return CanonicalGrantSnapshotSchema.parse({
      ...snapshot,
      sections: snapshot.sections.map((candidate) => candidate.sectionId === section.sectionId
        ? { ...candidate, nodeIds: nextNodeIds }
        : candidate),
      nodes: [
        ...snapshot.nodes.map((node) => node.sectionId === section.sectionId && node.order > anchor.order
          ? { ...node, order: node.order + 1 }
          : node),
        {
          nodeId: operation.newNodeId,
          sectionId: section.sectionId,
          order: anchor.order + 1,
          nodeType: "paragraph" as const,
          content: { text: operation.newText },
        },
      ],
    });
  }
  if (operation.type === "replace_selection") {
    return CanonicalGrantSnapshotSchema.parse({
      ...snapshot,
      nodes: snapshot.nodes.map((node) => node.nodeId === operation.nodeId
        ? { ...node, content: { ...node.content, text: `${grantEditableNodeText(snapshot, node.nodeId).slice(0, operation.startOffset)}${operation.newText}${grantEditableNodeText(snapshot, node.nodeId).slice(operation.endOffset)}` } }
        : node),
    });
  }
  return CanonicalGrantSnapshotSchema.parse({
    ...snapshot,
    nodes: snapshot.nodes.map((node) => {
      if (node.nodeId !== operation.nodeId) return node;
      if (node.nodeType === "paragraph") return { ...node, content: { text: operation.newText } };
      if (node.nodeType === "heading") return { ...node, content: { ...node.content, text: operation.newText } };
      return node;
    }),
  });
}
