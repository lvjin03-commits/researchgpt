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

export function validateGrantPatchOperation(
  snapshot: CanonicalGrantSnapshot,
  proposal: GrantPatchProposal,
): GrantPatchOperation {
  if (proposal.operations.length !== 1 || proposal.targetNodeIds.length !== 1) {
    throw new GrantPatchPolicyError("grant_patch_scope_invalid", "A proposal must target exactly one node.");
  }
  const operation = proposal.operations[0];
  if (operation.nodeId !== proposal.targetNodeIds[0]) {
    throw new GrantPatchPolicyError("grant_patch_scope_invalid", "The model output exceeded the authorized target.");
  }
  const currentText = grantEditableNodeText(snapshot, operation.nodeId);
  if (operation.oldText !== currentText || operation.expectedTextHash !== grantTextHash(currentText)) {
    throw new GrantPatchPolicyError("grant_patch_stale", "The target text changed after this proposal was created.");
  }
  if (!operation.newText.trim() || operation.newText === currentText) {
    throw new GrantPatchPolicyError("grant_patch_empty_change", "The proposal does not contain a valid text change.");
  }
  return operation;
}

export function applyGrantPatch(
  snapshot: CanonicalGrantSnapshot,
  proposal: GrantPatchProposal,
): CanonicalGrantSnapshot {
  const operation = validateGrantPatchOperation(snapshot, proposal);
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
