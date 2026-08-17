import { sha256Canonical } from "../domain/canonical-json.ts";
import { randomUUID } from "node:crypto";
import { GrantAssistantModelError, type GrantAssistantChatMessage } from "../ports/grant-assistant-model.ts";
import type { GrantModelCallRepository } from "../ports/grant-model-call-repository.ts";
import { GRANT_ASSISTANT_CHAT_OPERATION, resolveGrantModelOperationPolicy, type GrantModelFailureCategory } from "../model-execution/operation-registry.ts";
import { GrantModelDataGateway } from "./grant-model-data-gateway.ts";
import { GrantModelExecutor } from "./grant-model-executor.ts";
import { GrantRevisionConflictError, GrantRevisionService } from "./revision-service.ts";
import type { GrantAssistantDocumentSelectionContext } from "../assistant/contracts.ts";
import { validateGrantAssistantGroundedAnswer } from "../assistant/grounded-answer-validator.ts";
import type { GrantAssistantSessionRepository } from "../ports/grant-assistant-session-repository.ts";
import type { GrantAssistantMessage } from "../assistant/session-contracts.ts";

export class GrantAssistantChatError extends Error {
  readonly code: "grant_assistant_duplicate_turn" | "grant_assistant_history_invalid";
  constructor(code: GrantAssistantChatError["code"], message: string) {
    super(message);
    this.name = "GrantAssistantChatError";
    this.code = code;
  }
}

export class GrantAssistantChatService {
  private readonly dependencies: {
    revisionService: GrantRevisionService;
    modelGateway: GrantModelDataGateway;
    modelExecutor: GrantModelExecutor;
    modelCalls: GrantModelCallRepository;
    configuredGrantModelId: string;
    sessions: GrantAssistantSessionRepository;
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
  }) {
    const aggregate = await this.dependencies.revisionService.getDocument(input.documentId);
    if (aggregate.document.currentRevisionId !== input.expectedRevisionId) throw new GrantRevisionConflictError(aggregate.document.currentRevisionId);
    const question = input.message.trim();
    if (!question || question.length > 12000) throw new GrantAssistantChatError("grant_assistant_history_invalid", "Grant assistant message is invalid.");
    const existing = await this.dependencies.modelCalls.listByTrace(input.documentId, input.turnId);
    if (existing.length > 0) throw new GrantAssistantChatError("grant_assistant_duplicate_turn", "This assistant turn was already submitted.");
    const now = new Date().toISOString();
    const session = await this.dependencies.sessions.ensureSession({ documentId: input.documentId, sessionId: randomUUID(), now });
    const stored = await this.dependencies.sessions.listMessages(session.sessionId);
    const opening = stored[0];
    const recent = stored.slice(-10).filter((message) => message.messageId !== opening?.messageId);
    const messages: GrantAssistantChatMessage[] = [
      ...(opening ? [{ role: opening.role, content: opening.content }] : []),
      ...recent.map(({ role, content }) => ({ role, content })),
      { role: "user", content: question },
    ];
    const policy = resolveGrantModelOperationPolicy({ operation: GRANT_ASSISTANT_CHAT_OPERATION, configuredGrantModelId: this.dependencies.configuredGrantModelId });
    const execution = await this.dependencies.modelExecutor.execute({
      documentId: input.documentId,
      turnId: input.turnId,
      traceId: input.turnId,
      inputHash: sha256Canonical({ sourceRevisionId: input.expectedRevisionId, messages, contextCards: input.contextCards, evidenceSourceIds: input.evidenceSourceIds }),
      policy,
      classifyFailure: (error): GrantModelFailureCategory => error instanceof GrantAssistantModelError ? error.category : "provider_unavailable",
      invoke: async ({ attemptPurpose }) => {
        const result = await this.dependencies.modelGateway.answerAssistantChat({
          documentId: input.documentId,
          sourceRevisionId: input.expectedRevisionId,
          snapshot: aggregate.currentRevision.snapshot,
          messages,
          contextCards: input.contextCards,
          evidenceSourceIds: input.evidenceSourceIds,
          taskId: input.turnId,
          attemptPurpose,
        });
        const grounded = validateGrantAssistantGroundedAnswer(result);
        return {
          value: { content: result.content, provider: result.provider, modelId: result.modelId, ...grounded },
          outputHash: sha256Canonical({ content: result.content, ...grounded }),
          providerRequestId: result.providerRequestId,
          usage: result.usage,
        };
      },
    });
    const userMessage: GrantAssistantMessage = { messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId, role: "user", content: question, citations: [], createdAt: now };
    const assistantMessage: GrantAssistantMessage = {
      messageId: randomUUID(), sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId,
      role: "assistant", content: execution.value.content, grounding: execution.value.grounding,
      citations: execution.value.citations.map(({ citationId, sourceType, label }) => ({ citationId, sourceType, label })), createdAt: new Date().toISOString(),
    };
    await this.dependencies.sessions.appendTurn({ sessionId: session.sessionId, userMessage, assistantMessage, lastActiveAt: assistantMessage.createdAt });
    return { sessionId: session.sessionId, turnId: input.turnId, traceId: execution.traceId, operation: policy.operation, attempts: execution.attempts, ...execution.value };
  }
}
