import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { computeGrantCandidateDiff } from "../edit-session/candidate-diff.ts";
import { GrantCandidateExplanationSchema } from "../edit-session/candidate-explanation.ts";
import { buildGrantCandidateExplanationContext, GrantCandidateExplanationContextBudgetError } from "../edit-session/candidate-explanation-context.ts";
import {
  GRANT_EDIT_CANDIDATE_EXPLAIN_OPERATION,
  resolveGrantModelOperationPolicy,
  type GrantModelFailureCategory,
} from "../model-execution/operation-registry.ts";
import { grantEditableNodeText, grantTextHash } from "../patching/patch-policy.ts";
import type { GrantCandidateExplanationModelError } from "../ports/grant-candidate-explanation-model.ts";
import type { GrantCandidateExplanationRepository } from "../ports/grant-candidate-explanation-repository.ts";
import type { GrantAiEditSessionRepository } from "../ports/grant-ai-edit-session-repository.ts";
import type { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import { GrantModelExecutor } from "./grant-model-executor.ts";
import type { GrantRevisionService } from "./revision-service.ts";

export class GrantCandidateExplanationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GrantCandidateExplanationError";
    this.code = code;
  }
}

const issueMessages: Record<string, string> = {
  new_reference_forbidden: "候选稿包含不允许由模型新增的参考文献条目。",
  claim_binding_missing: "候选稿包含没有来源绑定的新增事实断言。",
  claim_binding_unknown: "候选稿包含无法解析到已知来源的事实绑定。",
  claim_source_unauthorized: "候选稿的事实断言绑定到了当前未授权来源。",
};

type Dependencies = {
  repository: GrantAiEditSessionRepository;
  revisionService: Pick<GrantRevisionService, "getRevision">;
  modelGateway: Pick<GrantModelDataGateway, "inspectCandidateExplanationSources" | "explainEditCandidate">;
  modelExecutor: GrantModelExecutor;
  explanationRepository: GrantCandidateExplanationRepository;
  configuredGrantModelId: string;
  createId?: () => string;
  now?: () => string;
  classifyFailure?: (error: unknown) => GrantModelFailureCategory;
};

export class GrantCandidateExplanationService {
  private readonly dependencies: Dependencies;
  private readonly createId: () => string;
  private readonly now: () => string;
  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  private blockingIssues(candidate: Awaited<ReturnType<GrantAiEditSessionRepository["listCandidates"]>>[number]) {
    const blockingIssues: Array<{ code: string; message: string }> = candidate.factCheck.issues.map((issue) => ({
      code: issue.code,
      message: issueMessages[issue.code] ?? "候选稿存在程序识别的阻断问题。",
    }));
    if (candidate.safetyState === "blocked" && blockingIssues.length === 0) blockingIssues.push({ code: "candidate_blocked", message: "候选稿当前处于阻断状态，不能应用到正文。" });
    if (candidate.safetyState === "needs_repair") blockingIssues.unshift({ code: "candidate_needs_repair", message: "候选稿依赖的资料授权已经变化，必须先修复。" });
    return blockingIssues;
  }

  private async prepare(input: { documentId: string; sessionId: string; candidateId: string }) {
    const session = await this.dependencies.repository.getSession(input.sessionId);
    if (!session) throw new GrantCandidateExplanationError("session_not_found", "The Edit Session does not exist.");
    if (session.documentId !== input.documentId) throw new GrantCandidateExplanationError("session_not_found", "The Edit Session does not belong to this document.");
    const candidates = await this.dependencies.repository.listCandidates(session.sessionId);
    const candidate = candidates.find((item) => item.candidateId === input.candidateId);
    if (!candidate) throw new GrantCandidateExplanationError("candidate_not_found", "The Candidate does not belong to this Edit Session.");
    const baseRevision = await this.dependencies.revisionService.getRevision(session.documentId, session.baseRevisionId);
    const originalNodeText = grantEditableNodeText(baseRevision.snapshot, session.targetNodeId);
    const originalBase = session.editMode === "replace_selection" ? session.selectedText! : originalNodeText;
    const semanticBase = candidate.semanticBaseCandidateId
      ? candidates.find((item) => item.candidateId === candidate.semanticBaseCandidateId)
      : undefined;
    if (candidate.semanticBaseCandidateId && !semanticBase) {
      throw new GrantCandidateExplanationError("candidate_base_invalid", "The Candidate semantic base is missing.");
    }
    const diff = computeGrantCandidateDiff({ oldText: semanticBase?.text ?? originalBase, newText: candidate.text });
    if (diff.changes.length === 0) throw new GrantCandidateExplanationError("candidate_diff_empty", "The Candidate has no changes to explain.");
    return { session, candidate, semanticBaseText: semanticBase?.text ?? originalBase, diff, blockingIssues: this.blockingIssues(candidate) };
  }

  async getDiff(input: { documentId: string; sessionId: string; candidateId: string }) {
    const prepared = await this.prepare(input);
    return { candidateId: prepared.candidate.candidateId, safetyState: prepared.candidate.safetyState, diff: prepared.diff, blockingIssues: prepared.blockingIssues };
  }

  async explain(input: { documentId: string; sessionId: string; candidateId: string }) {
    const { session, candidate, semanticBaseText, diff, blockingIssues } = await this.prepare(input);
    const traceId = this.createId();
    const sources = await this.dependencies.modelGateway.inspectCandidateExplanationSources({
      documentId: session.documentId,
      taskId: traceId,
      evidenceBindings: candidate.context.evidenceBindings,
    });
    const policy = resolveGrantModelOperationPolicy({
      operation: GRANT_EDIT_CANDIDATE_EXPLAIN_OPERATION,
      configuredGrantModelId: this.dependencies.configuredGrantModelId,
    });
    const factCheckFingerprint = sha256Canonical(candidate.factCheck);
    const evidenceAuthorizationFingerprint = sha256Canonical(sources);
    let modelContext;
    try {
      modelContext = buildGrantCandidateExplanationContext({
        diff,
        blockingIssues,
        sources: sources.map(({ sourceTitle, currentlyAuthorized, status }) => ({ sourceTitle, currentlyAuthorized, status })),
      });
    } catch (error) {
      if (error instanceof GrantCandidateExplanationContextBudgetError) {
        throw new GrantCandidateExplanationError(error.code, "候选稿差异和必要安全信息超过本次解释容量，请缩小修改范围。");
      }
      throw error;
    }
    const cacheKey = sha256Canonical({
      candidateId: candidate.candidateId,
      candidateContentHash: candidate.textHash,
      semanticBaseHash: grantTextHash(semanticBaseText),
      diffHash: diff.diffHash,
      diffContractVersion: diff.contractVersion,
      candidateSafetyState: candidate.safetyState,
      factCheckFingerprint,
      evidenceAuthorizationFingerprint,
      explanationPolicyVersion: policy.policyVersion,
    });
    const claimedAt = this.now();
    const claim = await this.dependencies.explanationRepository.claim({
      cacheKey, documentId: session.documentId, sessionId: session.sessionId,
      candidateId: candidate.candidateId, diffHash: diff.diffHash, traceId,
      claimedAt, leaseExpiresAt: new Date(Date.parse(claimedAt) + 120_000).toISOString(),
    });
    if (claim.state === "completed") return { traceId: claim.traceId, attempts: 0, cacheHit: true, cacheKey, diff, explanation: claim.explanation };
    if (claim.state === "in_progress") throw new GrantCandidateExplanationError("candidate_explanation_in_progress", "An identical Candidate explanation is already running.");
    const classifyFailure = this.dependencies.classifyFailure ?? ((error: unknown) => (error as GrantCandidateExplanationModelError)?.category ?? "unknown_provider_failure");
    try {
      const execution = await this.dependencies.modelExecutor.execute({
        documentId: session.documentId,
        sessionId: session.sessionId,
        traceId,
        inputHash: cacheKey,
        policy,
        classifyFailure,
        invoke: async ({ attemptPurpose }) => {
          const value = await this.dependencies.modelGateway.explainEditCandidate({
            documentLanguage: /[\u3400-\u9fff]/u.test(candidate.text) ? "zh" : "en",
            diff: modelContext.diff,
            blockingIssues: modelContext.blockingIssues,
            sources: modelContext.sources,
            attemptPurpose,
          });
          const expectedIndexes = diff.changes.map((_, index) => index);
          const actualIndexes = value.changes.map((change) => change.changeIndex);
          if (new Set(actualIndexes).size !== actualIndexes.length || !expectedIndexes.every((index, position) => actualIndexes[position] === index)) {
            throw Object.assign(new Error("Candidate explanation change references do not match the program Diff."), { category: "structured_reference_invalid" });
          }
          return { value, outputHash: sha256Canonical(value), providerRequestId: value.providerRequestId, usage: value.usage };
        },
      });
      const explanation = GrantCandidateExplanationSchema.parse({
        candidateId: candidate.candidateId,
        diffHash: diff.diffHash,
        summary: execution.value.summary,
        changes: execution.value.changes,
        blockingIssues,
        cautions: execution.value.cautions,
        sources,
        provider: execution.value.provider,
        modelId: execution.value.modelId,
        createdAt: this.now(),
      });
      await this.dependencies.explanationRepository.complete({ cacheKey, traceId: execution.traceId, explanation, completedAt: this.now() });
      return { traceId: execution.traceId, attempts: execution.attempts, cacheHit: false, cacheKey, diff, explanation };
    } catch (error) {
      await this.dependencies.explanationRepository.fail({ cacheKey, traceId, failureCategory: classifyFailure(error), failedAt: this.now() });
      throw error;
    }
  }
}
