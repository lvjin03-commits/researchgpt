import { computeGrantCandidateDiff } from "./candidate-diff.ts";
import { grantEditableNodeText } from "../patching/patch-policy.ts";
import type { GrantAiEditSessionRepository } from "../ports/grant-ai-edit-session-repository.ts";
import type { GrantRevisionService } from "../application/revision-service.ts";

const ISSUE_MESSAGES: Record<string, string> = {
  new_reference_forbidden: "候选稿包含不允许由模型新增的参考文献条目。",
  claim_binding_missing: "候选稿包含没有来源绑定的新增事实断言。",
  claim_binding_unknown: "候选稿包含无法解析到已知来源的事实绑定。",
  claim_source_unauthorized: "候选稿的事实断言绑定到了当前未授权来源。",
};

export async function prepareGrantCandidateAnalysis(
  input: { documentId: string; sessionId: string; candidateId: string },
  dependencies: {
    repository: GrantAiEditSessionRepository;
    revisionService: Pick<GrantRevisionService, "getRevision">;
  },
  createError: (code: string, message: string) => Error,
) {
  const session = await dependencies.repository.getSession(input.sessionId);
  if (!session || session.documentId !== input.documentId) {
    throw createError("session_not_found", "The Edit Session does not belong to this document.");
  }
  const candidates = await dependencies.repository.listCandidates(session.sessionId);
  const candidate = candidates.find((item) => item.candidateId === input.candidateId);
  if (!candidate) throw createError("candidate_not_found", "The Candidate does not belong to this Edit Session.");
  const baseRevision = await dependencies.revisionService.getRevision(session.documentId, session.baseRevisionId);
  const originalNodeText = grantEditableNodeText(baseRevision.snapshot, session.targetNodeId);
  const originalBase = session.editMode === "replace_selection" ? session.selectedText! : originalNodeText;
  const semanticBase = candidate.semanticBaseCandidateId
    ? candidates.find((item) => item.candidateId === candidate.semanticBaseCandidateId)
    : undefined;
  if (candidate.semanticBaseCandidateId && !semanticBase) {
    throw createError("candidate_base_invalid", "The Candidate semantic base is missing.");
  }
  const semanticBaseText = semanticBase?.text ?? originalBase;
  const diff = computeGrantCandidateDiff({ oldText: semanticBaseText, newText: candidate.text });
  if (diff.changes.length === 0) throw createError("candidate_diff_empty", "The Candidate has no changes to discuss.");
  const blockingIssues: Array<{ code: string; message: string }> = candidate.factCheck.issues.map((issue) => ({
    code: issue.code,
    message: ISSUE_MESSAGES[issue.code] ?? "候选稿存在程序识别的阻断问题。",
  }));
  if (candidate.safetyState === "blocked" && blockingIssues.length === 0) {
    blockingIssues.push({ code: "candidate_blocked", message: "候选稿当前处于阻断状态，不能应用到正文。" });
  }
  if (candidate.safetyState === "needs_repair") {
    blockingIssues.unshift({ code: "candidate_needs_repair", message: "候选稿依赖的资料授权已经变化，必须先修复。" });
  }
  return { session, candidate, semanticBaseText, diff, blockingIssues };
}
