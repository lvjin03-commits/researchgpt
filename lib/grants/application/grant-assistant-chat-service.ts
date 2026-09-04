import { sha256Canonical } from "../domain/canonical-json.ts";
import { randomUUID } from "node:crypto";
import { GrantAssistantModelError, type GrantAssistantChatMessage } from "../ports/grant-assistant-model.ts";
import type { GrantModelCallRepository } from "../ports/grant-model-call-repository.ts";
import { GRANT_ASSISTANT_CHAT_OPERATION, resolveGrantModelOperationPolicy, type GrantModelFailureCategory } from "../model-execution/operation-registry.ts";
import type { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import { GrantModelExecutor } from "./grant-model-executor.ts";
import { GrantRevisionConflictError, GrantRevisionService } from "./revision-service.ts";
import type { GrantAssistantCandidateContext, GrantAssistantDocumentSelectionContext } from "../assistant/contracts.ts";
import { validateGrantAssistantGroundedAnswer } from "../assistant/grounded-answer-validator.ts";
import type { GrantAssistantSessionRepository } from "../ports/grant-assistant-session-repository.ts";
import type { GrantAssistantMessage } from "../assistant/session-contracts.ts";
import { candidateContextFocus, documentSelectionFocuses, resolveGrantAssistantFocus, type GrantAssistantFocus } from "../assistant/focus-state.ts";
import type { GrantAiEditSessionRepository } from "../ports/grant-ai-edit-session-repository.ts";
import { prepareGrantCandidateAnalysis } from "../edit-session/candidate-analysis.ts";
import { grantAssistantCacheKey, grantCandidateRecommendedQuestions } from "../assistant/chat-intelligence.ts";
import { retrieveGrantDocumentBlocks } from "./grant-document-retriever.ts";

export class GrantAssistantChatError extends Error {
  readonly code: "grant_assistant_duplicate_turn" | "grant_assistant_history_invalid" | "grant_assistant_focus_ambiguous";
  readonly focusChoices?: GrantAssistantFocus[];
  constructor(code: GrantAssistantChatError["code"], message: string, focusChoices?: GrantAssistantFocus[]) {
    super(message);
    this.name = "GrantAssistantChatError";
    this.code = code;
    this.focusChoices = focusChoices;
  }
}

export class GrantAssistantChatService {
  private readonly dependencies: {
    revisionService: Pick<GrantRevisionService, "getDocument" | "getRevision">;
    modelGateway: Pick<GrantModelDataGateway, "answerAssistantChat" | "validateAssistantDocumentSelections">;
    modelExecutor: GrantModelExecutor;
    modelCalls: GrantModelCallRepository;
    configuredGrantModelId: string;
    sessions: GrantAssistantSessionRepository;
    editSessions: GrantAiEditSessionRepository;
  };

  constructor(dependencies: GrantAssistantChatService["dependencies"]) {
    this.dependencies = dependencies;
  }

  async getCurrent(documentId: string) {
    await this.dependencies.revisionService.getDocument(documentId);
    const existing = await this.dependencies.sessions.getCurrentSession(documentId);
    if (!existing) return { session: null, messages: [] };
    const session = await this.dependencies.sessions.ensureSession({ documentId, sessionId: existing.sessionId, now: new Date().toISOString() });
    return { session, messages: await this.dependencies.sessions.listMessages(session.sessionId) };
  }

  async linkEditSession(input: { documentId: string; editSessionId: string }) {
    await this.dependencies.revisionService.getDocument(input.documentId);
    const session = await this.dependencies.sessions.ensureSession({ documentId: input.documentId, sessionId: randomUUID(), now: new Date().toISOString() });
    await this.dependencies.sessions.linkEditSession({ assistantSessionId: session.sessionId, editSessionId: input.editSessionId, linkedAt: new Date().toISOString() });
    return { assistantSessionId: session.sessionId, editSessionId: input.editSessionId };
  }

  async answer(input: {
    documentId: string;
    expectedRevisionId: string;
    turnId: string;
    message: string;
    contextCards: GrantAssistantDocumentSelectionContext[];
    evidenceSourceIds: string[];
    focusId?: string | null;
    ignoreAmbiguousFocus?: boolean;
    candidateContext?: GrantAssistantCandidateContext | null;
  }) {
    const aggregate = await this.dependencies.revisionService.getDocument(input.documentId);
    if (aggregate.document.currentRevisionId !== input.expectedRevisionId) throw new GrantRevisionConflictError(aggregate.document.currentRevisionId);
    const question = input.message.trim();
    if (!question || question.length > 12000) throw new GrantAssistantChatError("grant_assistant_history_invalid", "Grant assistant message is invalid.");
    // Browser selections are one-shot precision focus, never implicit chat
    // context. Without an explicit focusId, stale cards must not participate
    // in focus resolution or validation; ordinary turns use retrieval.
    const availableFocuses = [
      ...(input.focusId ? documentSelectionFocuses(input.contextCards) : []),
      ...(input.candidateContext ? [candidateContextFocus(input.candidateContext)] : []),
    ];
    const focusResolution = resolveGrantAssistantFocus({
      message: question,
      available: availableFocuses,
      explicitFocusId: input.focusId,
      ignoreAmbiguousFocus: input.ignoreAmbiguousFocus,
    });
    if (input.focusId && focusResolution.kind !== "resolved") {
      throw new GrantAssistantChatError("grant_assistant_history_invalid", "选择的讨论对象已不存在，请重新选择。");
    }
    if (focusResolution.kind === "ambiguous") {
      throw new GrantAssistantChatError("grant_assistant_focus_ambiguous", "请先确认这句话指的是哪一处内容。", focusResolution.choices);
    }
    // Ordinary chat is grounded by server-side retrieval. Only an explicitly
    // resolved document focus may carry a browser selection into validation;
    // stale cards from an older page/session must never block a normal turn.
    const effectiveContextCards = input.ignoreAmbiguousFocus || focusResolution.kind !== "resolved"
      ? []
      : focusResolution.focus.kind === "document_selection"
        ? input.contextCards.filter((card) => card.contextCardId === focusResolution.focus.focusId)
        : [];
    const retrievedDocumentBlocks = retrieveGrantDocumentBlocks({
      snapshot: aggregate.currentRevision.snapshot,
      sourceRevisionId: input.expectedRevisionId,
      query: question,
      limit: 6,
    });
    const candidateIsEffective = Boolean(input.candidateContext)
      && !input.ignoreAmbiguousFocus
      && (focusResolution.kind !== "resolved" || focusResolution.focus.kind === "edit_candidate");
    const candidateAnalysis = candidateIsEffective && input.candidateContext
      ? await prepareGrantCandidateAnalysis(
          { documentId: input.documentId, sessionId: input.candidateContext.editSessionId, candidateId: input.candidateContext.candidateId },
          { repository: this.dependencies.editSessions, revisionService: this.dependencies.revisionService },
          (code, message) => new GrantAssistantChatError("grant_assistant_history_invalid", `${code}: ${message}`),
        )
      : null;
    this.dependencies.modelGateway.validateAssistantDocumentSelections({
      documentId: input.documentId,
      sourceRevisionId: input.expectedRevisionId,
      snapshot: aggregate.currentRevision.snapshot,
      contextCards: effectiveContextCards,
    });
    if (candidateAnalysis && candidateAnalysis.candidate.textHash !== input.candidateContext!.expectedCandidateHash) {
      throw new GrantAssistantChatError("grant_assistant_history_invalid", "候选稿已经变化，请重新选择后再提问。");
    }
    const existing = await this.dependencies.modelCalls.listByTrace(input.documentId, input.turnId);
    if (existing.length > 0) throw new GrantAssistantChatError("grant_assistant_duplicate_turn", "This assistant turn was already submitted.");
    const now = new Date().toISOString();
    const session = await this.dependencies.sessions.ensureSession({ documentId: input.documentId, sessionId: randomUUID(), now });
    const stored = await this.dependencies.sessions.listMessages(session.sessionId);
    if (stored.some((message) => message.turnId === input.turnId)) {
      throw new GrantAssistantChatError("grant_assistant_duplicate_turn", "This assistant turn was already submitted.");
    }
    const policy = resolveGrantModelOperationPolicy({ operation: GRANT_ASSISTANT_CHAT_OPERATION, configuredGrantModelId: this.dependencies.configuredGrantModelId });
    const recommendedQuestions = candidateAnalysis
      ? grantCandidateRecommendedQuestions({ diff: candidateAnalysis.diff, safetyState: candidateAnalysis.candidate.safetyState, blockingIssues: candidateAnalysis.blockingIssues })
      : [];
    const resolvedSelection = focusResolution.kind === "resolved" && focusResolution.focus.kind === "document_selection"
      ? effectiveContextCards.find((card) => card.contextCardId === focusResolution.focus.focusId)
      : null;
    // Evidence-grounded cache reuse requires a current authorization fingerprint.
    // Until that is part of this key, attached evidence deliberately disables reuse.
    const cacheKey = input.evidenceSourceIds.length === 0 && (candidateAnalysis || resolvedSelection) ? grantAssistantCacheKey({
      question,
      sourceRevisionId: input.expectedRevisionId,
      policyVersion: policy.policyVersion,
      modelId: policy.modelId,
      focus: candidateAnalysis
        ? {
            kind: "edit_candidate",
            focusId: candidateAnalysis.candidate.candidateId,
            contentHash: candidateAnalysis.diff.diffHash,
            safetyFingerprint: sha256Canonical({ safetyState: candidateAnalysis.candidate.safetyState, blockingIssues: candidateAnalysis.blockingIssues }),
          }
        : { kind: "document_selection", focusId: resolvedSelection!.contextCardId, contentHash: resolvedSelection!.textHash },
    }) : null;
    const cachedUser = cacheKey ? [...stored].reverse().find((message) => message.role === "user" && message.cacheKey === cacheKey) : undefined;
    const cachedAssistant = cachedUser
      ? stored.find((message) => message.role === "assistant" && message.turnId === cachedUser.turnId && message.cachedAnswer)
      : undefined;
    if (cacheKey && cachedAssistant?.cachedAnswer) {
      const userMessage: GrantAssistantMessage = { messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: input.turnId, role: "user", content: question, citations: [], cacheKey, createdAt: now };
      const assistantMessage: GrantAssistantMessage = {
        messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: input.turnId, role: "assistant",
        content: cachedAssistant.cachedAnswer.content, grounding: cachedAssistant.cachedAnswer.grounding,
        citations: cachedAssistant.cachedAnswer.citations.map(({ citationId, sourceType, label }) => ({ citationId, sourceType, label })),
        cachedAnswer: cachedAssistant.cachedAnswer,
        recommendedQuestions: cachedAssistant.recommendedQuestions ?? recommendedQuestions,
        createdAt: new Date().toISOString(),
      };
      await this.dependencies.sessions.appendTurn({ sessionId: session.sessionId, userMessage, assistantMessage, lastActiveAt: assistantMessage.createdAt });
      return {
        sessionId: session.sessionId, turnId: input.turnId, traceId: input.turnId, operation: policy.operation,
        attempts: 0, cached: true, focus: focusResolution,
        recommendedQuestions: assistantMessage.recommendedQuestions ?? [],
        ...cachedAssistant.cachedAnswer,
      };
    }
    const opening = stored[0];
    const recent = stored.slice(-10).filter((message) => message.messageId !== opening?.messageId);
    const messages: GrantAssistantChatMessage[] = [
      ...(opening ? [{ role: opening.role, content: opening.content }] : []),
      ...recent.map(({ role, content }) => ({ role, content })),
      { role: "user", content: question },
    ];
    const execution = await this.dependencies.modelExecutor.execute({
      documentId: input.documentId,
      turnId: input.turnId,
      traceId: input.turnId,
      inputHash: sha256Canonical({ sourceRevisionId: input.expectedRevisionId, messages, focusResolution, contextCards: effectiveContextCards, candidateContext: candidateAnalysis ? { candidateId: candidateAnalysis.candidate.candidateId, textHash: candidateAnalysis.candidate.textHash, diffHash: candidateAnalysis.diff.diffHash } : null, evidenceSourceIds: input.evidenceSourceIds }),
      policy,
      classifyFailure: (error): GrantModelFailureCategory => error instanceof GrantAssistantModelError ? error.category : "provider_unavailable",
      invoke: async ({ attemptPurpose }) => {
        const result = await this.dependencies.modelGateway.answerAssistantChat({
          documentId: input.documentId,
          sourceRevisionId: input.expectedRevisionId,
          snapshot: aggregate.currentRevision.snapshot,
          messages,
          contextCards: effectiveContextCards,
          retrievedDocumentBlocks,
          candidateContext: candidateAnalysis ? {
            candidateId: candidateAnalysis.candidate.candidateId,
            targetLabel: input.candidateContext!.targetLabel,
            candidateText: candidateAnalysis.candidate.text,
            safetyState: candidateAnalysis.candidate.safetyState,
            diff: candidateAnalysis.diff,
            blockingIssues: candidateAnalysis.blockingIssues,
          } : null,
          evidenceSourceIds: input.evidenceSourceIds,
          taskId: input.turnId,
          attemptPurpose,
        });
        const answer = validateGrantAssistantGroundedAnswer(result);
        return {
          value: { ...answer, provider: result.provider, modelId: result.modelId },
          outputHash: sha256Canonical(answer),
          providerRequestId: result.providerRequestId,
          usage: result.usage,
        };
      },
    });
    const userMessage: GrantAssistantMessage = { messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId, role: "user", content: question, citations: [], ...(cacheKey ? { cacheKey } : {}), createdAt: now };
    const assistantMessage: GrantAssistantMessage = {
      messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId,
      role: "assistant", content: execution.value.content, grounding: execution.value.grounding,
      citations: execution.value.citations.map(({ citationId, sourceType, label }) => ({ citationId, sourceType, label })),
      cachedAnswer: execution.value, recommendedQuestions, createdAt: new Date().toISOString(),
    };
    await this.dependencies.sessions.appendTurn({ sessionId: session.sessionId, userMessage, assistantMessage, lastActiveAt: assistantMessage.createdAt });
    return { sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId, operation: policy.operation, attempts: execution.attempts, cached: false, focus: focusResolution, recommendedQuestions, ...execution.value };
  }
}
