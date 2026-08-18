import { sha256Canonical } from "../domain/canonical-json.ts";
import type { GrantCandidateDiff } from "../edit-session/candidate-diff.ts";

export function normalizeGrantAssistantQuestion(question: string) {
  return question.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

export function grantAssistantCacheKey(input: {
  question: string;
  sourceRevisionId: string;
  policyVersion: string;
  modelId: string;
  focus: null | { kind: string; focusId: string; contentHash: string; safetyFingerprint?: string };
}) {
  return sha256Canonical({
    normalizedQuestion: normalizeGrantAssistantQuestion(input.question),
    sourceRevisionId: input.sourceRevisionId,
    policyVersion: input.policyVersion,
    modelId: input.modelId,
    focus: input.focus,
  });
}

export function grantCandidateRecommendedQuestions(input: {
  diff: GrantCandidateDiff;
  safetyState: "passed" | "needs_confirmation" | "blocked" | "needs_repair";
  blockingIssues: ReadonlyArray<unknown>;
}) {
  const questions: string[] = ["为什么这样修改？"];
  if (input.diff.counts.replacements > 0) questions.push("主要改写了哪些表达，理由是什么？");
  if (input.diff.counts.insertions > 0) questions.push("新增内容有哪些，是否都有依据？");
  if (input.diff.counts.deletions > 0) questions.push("删除了哪些内容，会不会损失关键信息？");
  if (input.diff.counts.moves > 0) questions.push("为什么调整这些段落的顺序？");
  if (input.safetyState !== "passed" || input.blockingIssues.length > 0) questions.unshift("这版目前有哪些事实或安全风险？");
  questions.push("和原文相比，哪一版更适合国自然申请书？");
  return [...new Set(questions)].slice(0, 4);
}
