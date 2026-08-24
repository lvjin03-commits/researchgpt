import { randomUUID } from "node:crypto";
import { sha256Canonical } from "../domain/canonical-json.ts";
import { GrantAiEditCandidateSchema, GrantAiEditSessionSchema, GrantAiEditTurnSchema } from "../edit-session/contracts.ts";
import { evaluateGrantAiEditFactSafety } from "../edit-session/fact-safety.ts";
import { GRANT_EDIT_SESSION_TURN_OPERATION, resolveGrantModelOperationPolicy, type GrantModelFailureCategory } from "../model-execution/operation-registry.ts";
import { grantEditableNodeText, grantTextHash } from "../patching/patch-policy.ts";
import type { GrantAiEditSessionRepository } from "../ports/grant-ai-edit-session-repository.ts";
import type { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import { GrantModelExecutionError, GrantModelExecutor } from "./grant-model-executor.ts";
import type { GrantRevisionService } from "./revision-service.ts";
import type { GrantPatchService } from "./patch-service.ts";

export class GrantAiEditSessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "GrantAiEditSessionError"; }
}

type Dependencies = {
  repository: GrantAiEditSessionRepository;
  revisionService: GrantRevisionService;
  modelGateway: Pick<GrantModelDataGateway, "proposeEditSessionTurn" | "validateEditSessionCandidateContext">;
  modelExecutor: GrantModelExecutor;
  patchService: Pick<GrantPatchService, "proposeApprovedCandidate" | "accept">;
  configuredGrantModelId: string;
  createId?: () => string;
  now?: () => string;
  classifyFailure?: (error: unknown) => GrantModelFailureCategory;
};

export class GrantAiEditSessionService {
  private readonly dependencies: Dependencies;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly classifyFailure: (error: unknown) => GrantModelFailureCategory;
  constructor(dependencies: Dependencies) {
    this.dependencies = dependencies;
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.classifyFailure = dependencies.classifyFailure ?? (() => "unknown_provider_failure");
  }

  async createSession(input: {
    documentId: string; baseRevisionId: string; targetNodeId: string; expectedNodeHash: string;
    editMode: "replace" | "replace_selection" | "insert_after"; actorId: string;
    originFindingId?: string; selectedText?: string; selectionStart?: number; selectionEnd?: number;
  }) {
    const aggregate = await this.dependencies.revisionService.getDocument(input.documentId);
    if (aggregate.document.currentRevisionId !== input.baseRevisionId) throw new GrantAiEditSessionError("revision_stale", "The source revision is no longer current.");
    const currentText = grantEditableNodeText(aggregate.currentRevision.snapshot, input.targetNodeId);
    if (grantTextHash(currentText) !== input.expectedNodeHash) throw new GrantAiEditSessionError("node_stale", "The target text has changed.");
    if (input.editMode === "replace_selection") {
      if (input.selectionStart === undefined || input.selectionEnd === undefined || currentText.slice(input.selectionStart, input.selectionEnd) !== input.selectedText) {
        throw new GrantAiEditSessionError("selection_stale", "The selected text no longer matches the document.");
      }
    }
    const timestamp = this.now();
    const session = GrantAiEditSessionSchema.parse({
      sessionId: this.createId(), documentId: input.documentId, baseRevisionId: input.baseRevisionId,
      targetNodeId: input.targetNodeId, expectedNodeHash: input.expectedNodeHash, editMode: input.editMode,
      selectedText: input.selectedText, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
      originFindingId: input.originFindingId, status: "active", createdBy: input.actorId,
      createdAt: timestamp, lastActiveAt: timestamp,
    });
    await this.dependencies.repository.createSession(session);
    return session;
  }

  async continueSession(input: { sessionId: string; instruction: string; evidenceSourceIds?: string[]; figureAssetIds?: string[] }) {
    const session = await this.dependencies.repository.getSession(input.sessionId);
    if (!session) throw new GrantAiEditSessionError("session_not_found", "The edit session does not exist.");
    if (session.status !== "active") throw new GrantAiEditSessionError("session_not_active", "The edit session is no longer active.");
    const aggregate = await this.dependencies.revisionService.getDocument(session.documentId);
    const nodeText = grantEditableNodeText(aggregate.currentRevision.snapshot, session.targetNodeId);
    if (aggregate.document.currentRevisionId !== session.baseRevisionId || grantTextHash(nodeText) !== session.expectedNodeHash) {
      await this.dependencies.repository.markSessionStale(session.sessionId, this.now());
      throw new GrantAiEditSessionError("session_stale", "The document changed while this edit session was open.");
    }
    const candidates = await this.dependencies.repository.listCandidates(session.sessionId);
    const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
    let basedOn = session.activeCandidateId ? byId.get(session.activeCandidateId) : undefined;
    if (basedOn && (basedOn.context.evidenceBindings.length > 0 || basedOn.context.figureAuthorization)) {
      const stillAuthorized = await this.dependencies.modelGateway.validateEditSessionCandidateContext({
        documentId: session.documentId, taskId: this.createId(),
        evidenceBindings: basedOn.context.evidenceBindings,
        figureAuthorization: basedOn.context.figureAuthorization,
      });
      if (!stillAuthorized) {
        await this.dependencies.repository.markCandidateNeedsRepair(basedOn.candidateId);
        basedOn = { ...basedOn, safetyState: "needs_repair", factCheck: { ...basedOn.factCheck, state: "needs_repair" } };
      }
    }
    const fallbackSafe = [...candidates].reverse().find((candidate) => candidate.safetyState === "passed" && candidate.candidateId !== basedOn?.candidateId);
    const semanticBase = basedOn?.safetyState === "passed" ? basedOn : fallbackSafe;
    const originalBase = session.editMode === "replace_selection" ? session.selectedText! : nodeText;
    const semanticBaseText = semanticBase?.text ?? originalBase;
    const turnId = this.createId();
    const traceId = this.createId();
    const turn = GrantAiEditTurnSchema.parse({
      turnId, sessionId: session.sessionId, traceId, basedOnCandidateId: basedOn?.candidateId,
      semanticBaseCandidateId: semanticBase?.candidateId, instruction: input.instruction,
      status: "running", createdAt: this.now(),
    });
    await this.dependencies.repository.createTurn(turn);
    const policy = resolveGrantModelOperationPolicy({ operation: GRANT_EDIT_SESSION_TURN_OPERATION, configuredGrantModelId: this.dependencies.configuredGrantModelId });
    try {
      const execution = await this.dependencies.modelExecutor.execute<Awaited<ReturnType<GrantModelDataGateway["proposeEditSessionTurn"]>>>({
        documentId: session.documentId, sessionId: session.sessionId, turnId, traceId,
        inputHash: sha256Canonical({ sessionId: session.sessionId, turnId, semanticBaseHash: grantTextHash(semanticBaseText), instruction: input.instruction }),
        policy, classifyFailure: this.classifyFailure,
        invoke: async () => {
          const value = await this.dependencies.modelGateway.proposeEditSessionTurn({
            documentId: session.documentId, taskId: turnId,
            snapshot: aggregate.currentRevision.snapshot, targetNodeId: session.targetNodeId,
            semanticBaseText, userInstruction: input.instruction,
            editMode: semanticBase ? "replace" : session.editMode,
            evidenceSourceIds: input.evidenceSourceIds,
            figureAssetIds: input.figureAssetIds,
          });
          return { value, outputHash: sha256Canonical(value), usage: value.usage };
        },
      });
      const factCheck = evaluateGrantAiEditFactSafety({
        oldText: semanticBaseText, newText: execution.value.replacementText,
        authorizedEvidenceCardIds: execution.value.evidenceBindings.map((binding) => binding.cardId),
      });
      const candidate = GrantAiEditCandidateSchema.parse({
        candidateId: this.createId(), sessionId: session.sessionId, producedByTurnId: turnId,
        basedOnCandidateId: basedOn?.candidateId, semanticBaseCandidateId: semanticBase?.candidateId,
        text: execution.value.replacementText, textHash: grantTextHash(execution.value.replacementText), safetyState: factCheck.state, factCheck,
        context: { evidenceBindings: execution.value.evidenceBindings, figureAuthorization: execution.value.figureAuthorization },
        rationale: execution.value.rationale, provider: execution.value.provider, modelId: execution.value.modelId, createdAt: this.now(),
      });
      await this.dependencies.repository.completeTurnWithCandidate({ turnId, completedAt: this.now(), candidate });
      return { sessionId: session.sessionId, turnId, traceId: execution.traceId, candidate };
    } catch (error) {
      const category = error instanceof GrantModelExecutionError ? error.category : this.classifyFailure(error);
      await this.dependencies.repository.failTurn({ turnId, completedAt: this.now(), failureCategory: category });
      throw error;
    }
  }

  async getSession(sessionId: string) {
    const session = await this.dependencies.repository.getSession(sessionId);
    if (!session) throw new GrantAiEditSessionError("session_not_found", "The edit session does not exist.");
    return { session, turns: await this.dependencies.repository.listTurns(sessionId), candidates: await this.dependencies.repository.listCandidates(sessionId) };
  }

  async applyActiveCandidate(input: { sessionId: string; candidateId: string; actorId: string }) {
    const session = await this.dependencies.repository.getSession(input.sessionId);
    if (!session) throw new GrantAiEditSessionError("session_not_found", "The edit session does not exist.");
    if (session.status === "applied") {
      return { session, proposalId: session.appliedProposalId!, revisionId: session.appliedRevisionId! };
    }
    if (session.status !== "active" || session.activeCandidateId !== input.candidateId) {
      throw new GrantAiEditSessionError("candidate_not_active", "Only the active Candidate can be applied.");
    }
    const candidate = (await this.dependencies.repository.listCandidates(session.sessionId))
      .find((item) => item.candidateId === input.candidateId);
    if (!candidate) throw new GrantAiEditSessionError("candidate_not_found", "The Candidate does not exist.");
    if (candidate.safetyState !== "passed") throw new GrantAiEditSessionError("candidate_not_safe", "Resolve Candidate safety issues before applying it.");
    const contextValid = await this.dependencies.modelGateway.validateEditSessionCandidateContext({
      documentId: session.documentId, taskId: this.createId(),
      evidenceBindings: candidate.context.evidenceBindings,
      figureAuthorization: candidate.context.figureAuthorization,
    });
    if (!contextValid) {
      await this.dependencies.repository.markCandidateNeedsRepair(candidate.candidateId);
      throw new GrantAiEditSessionError("candidate_needs_repair", "Attached material authorization changed; repair the Candidate before applying it.");
    }
    const aggregate = await this.dependencies.revisionService.getDocument(session.documentId);
    const currentText = grantEditableNodeText(aggregate.currentRevision.snapshot, session.targetNodeId);
    if (aggregate.currentRevision.revisionId !== session.baseRevisionId || grantTextHash(currentText) !== session.expectedNodeHash) {
      await this.dependencies.repository.markSessionStale(session.sessionId, this.now());
      throw new GrantAiEditSessionError("session_stale", "The document changed before the Candidate was applied.");
    }
    const proposal = await this.dependencies.patchService.proposeApprovedCandidate({
      documentId: session.documentId, baseRevisionId: session.baseRevisionId, targetNodeId: session.targetNodeId,
      findingId: session.originFindingId, instruction: `Apply Edit Session Candidate ${candidate.candidateId}`,
      editMode: session.editMode,
      selection: session.editMode === "replace_selection" ? { startOffset: session.selectionStart!, endOffset: session.selectionEnd!, text: session.selectedText! } : undefined,
      candidateText: candidate.text, candidateProvider: candidate.provider, candidateModelId: candidate.modelId,
      candidateRationale: candidate.rationale, evidenceBindings: candidate.context.evidenceBindings, actorId: input.actorId,
    });
    const accepted = await this.dependencies.patchService.accept(session.documentId, proposal.proposalId, input.actorId);
    const revisionId = accepted.aggregate.currentRevision.revisionId;
    await this.dependencies.repository.markSessionApplied({ sessionId: session.sessionId, candidateId: candidate.candidateId, proposalId: proposal.proposalId, revisionId, lastActiveAt: this.now() });
    return { session: (await this.dependencies.repository.getSession(session.sessionId))!, proposalId: proposal.proposalId, revisionId };
  }
}
