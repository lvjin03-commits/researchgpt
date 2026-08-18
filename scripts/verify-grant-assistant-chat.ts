import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantAssistantChatError, GrantAssistantChatService } from "../lib/grants/application/grant-assistant-chat-service.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import type { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import type { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { InMemoryGrantModelCallRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-model-call-repository.ts";
import { GrantAssistantModelError } from "../lib/grants/ports/grant-assistant-model.ts";
import { GrantAssistantGroundingError, validateGrantAssistantGroundedAnswer } from "../lib/grants/assistant/grounded-answer-validator.ts";
import type { GrantAssistantMessage, GrantAssistantSession } from "../lib/grants/assistant/session-contracts.ts";
import { documentSelectionFocuses, resolveGrantAssistantFocus } from "../lib/grants/assistant/focus-state.ts";
import { grantAssistantCacheKey, grantCandidateRecommendedQuestions, normalizeGrantAssistantQuestion } from "../lib/grants/assistant/chat-intelligence.ts";
import { computeGrantCandidateDiff } from "../lib/grants/edit-session/candidate-diff.ts";

const documentId = randomUUID();
const revisionId = randomUUID();
const turnId = randomUUID();
const modelCalls = new InMemoryGrantModelCallRepository();
let assistantSession: GrantAssistantSession | null = null;
const storedMessages: GrantAssistantMessage[] = [];
const sessions = {
  ensureSession: async (input: { documentId: string; sessionId: string; now: string }) => assistantSession ??= { sessionId: input.sessionId, documentId: input.documentId, status: "active" as const, createdAt: input.now, lastActiveAt: input.now },
  getCurrentSession: async () => assistantSession,
  listMessages: async () => storedMessages,
  appendTurn: async (input: { userMessage: GrantAssistantMessage; assistantMessage: GrantAssistantMessage }) => { storedMessages.push(input.userMessage, input.assistantMessage); },
  linkEditSession: async () => undefined,
};
let providerCalls = 0;
let lastProviderMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
let lastContextCardCount = 0;
const revisions = {
  getDocument: async () => ({ document: { currentRevisionId: revisionId }, currentRevision: { snapshot: { title: "测试申请书", sections: [], nodes: [] } } }),
} as unknown as GrantRevisionService;
const gateway = {
  validateAssistantDocumentSelections: () => [],
  answerAssistantChat: async (request: { attemptPurpose: string; messages: Array<{ role: "user" | "assistant"; content: string }>; contextCards: unknown[] }) => {
    providerCalls += 1;
    lastProviderMessages = request.messages;
    lastContextCardCount = request.contextCards.length;
    if (request.attemptPurpose === "initial") throw new GrantAssistantModelError("structured_output_invalid", "bad json");
    return { content: "这是页面内普通讨论，不会修改正文。", claims: [], citations: [], admittedContext: [], provider: "openai" as const, modelId: "gpt-test", providerRequestId: "req_chat", usage: { inputTokens: 10, outputTokens: 8, reasoningTokens: 1 } };
  },
} as unknown as GrantModelDataGateway;
const service = new GrantAssistantChatService({
  revisionService: revisions,
  modelGateway: gateway,
  modelExecutor: new GrantModelExecutor(modelCalls),
  modelCalls,
  configuredGrantModelId: "gpt-test",
  sessions,
  editSessions: {
    createSession: async () => undefined, getSession: async () => null, createTurn: async () => undefined,
    completeTurnWithCandidate: async () => undefined, failTurn: async () => undefined,
    markSessionStale: async () => undefined, markCandidateNeedsRepair: async () => undefined,
    markSessionApplied: async () => undefined, listTurns: async () => [], listCandidates: async () => [],
  },
});

const result = await service.answer({ documentId, expectedRevisionId: revisionId, turnId, message: "解释一下研究假设。", contextCards: [], evidenceSourceIds: [] });
assert.equal(result.operation, "grant.assistant.chat");
assert.equal(result.traceId, turnId);
assert.equal(result.attempts, 2);
assert.equal(providerCalls, 2);
assert.equal(storedMessages.length, 2);
assert.equal((await service.getCurrent(documentId)).messages.length, 2);
assert.deepEqual((await modelCalls.listByTrace(documentId, turnId)).map((item) => item.status), ["failed", "succeeded"]);

await assert.rejects(
  service.answer({ documentId, expectedRevisionId: revisionId, turnId, message: "重复请求", contextCards: [], evidenceSourceIds: [] }),
  (error) => error instanceof GrantAssistantChatError && error.code === "grant_assistant_duplicate_turn",
);
assert.equal(providerCalls, 2, "duplicate turn must not call the provider again");

await assert.rejects(
  service.answer({ documentId, expectedRevisionId: randomUUID(), turnId: randomUUID(), message: "陈旧版本", contextCards: [], evidenceSourceIds: [] }),
  /changed after this operation began/,
);
assert.equal(providerCalls, 2, "stale revision must fail before provider dispatch");

await service.answer({ documentId, expectedRevisionId: revisionId, turnId: randomUUID(), message: "继续解释第二个问题。", contextCards: [], evidenceSourceIds: [] });
assert.equal(lastProviderMessages[0]?.content, "解释一下研究假设。");
assert.equal(lastProviderMessages.at(-1)?.content, "继续解释第二个问题。");
assert.equal(storedMessages.length, 4);

const focusCard = (label: string) => ({
  kind: "document_selection" as const,
  contextCardId: randomUUID(), documentId, sourceRevisionId: revisionId,
  sectionId: randomUUID(), nodeId: randomUUID(), nodeTextHash: "a".repeat(64),
  startOffset: 0, endOffset: 2, text: "正文", textHash: "b".repeat(64),
  targetLabel: label, createdAt: new Date().toISOString(),
});
const focusCards = [focusCard("研究意义"), focusCard("研究方案")];
const ambiguousFocus = resolveGrantAssistantFocus({ message: "这段为什么这样写？", available: documentSelectionFocuses(focusCards) });
assert.equal(ambiguousFocus.kind, "ambiguous");
const beforeAmbiguousProviderCalls = providerCalls;
await assert.rejects(
  service.answer({ documentId, expectedRevisionId: revisionId, turnId: randomUUID(), message: "这段为什么这样写？", contextCards: focusCards, evidenceSourceIds: [] }),
  (error) => error instanceof GrantAssistantChatError && error.code === "grant_assistant_focus_ambiguous" && error.focusChoices?.length === 2,
);
assert.equal(providerCalls, beforeAmbiguousProviderCalls, "ambiguous focus must fail before provider dispatch");

await service.answer({
  documentId, expectedRevisionId: revisionId, turnId: randomUUID(), message: "这段为什么这样写？",
  contextCards: focusCards, evidenceSourceIds: [], focusId: focusCards[1]!.contextCardId,
});
assert.equal(lastContextCardCount, 1, "an explicit focus choice must admit only that selected context card");
const callsBeforeCacheHit = providerCalls;
const cacheHitTurnId = randomUUID();
const cached = await service.answer({
  documentId, expectedRevisionId: revisionId, turnId: cacheHitTurnId, message: "这段为什么这样写？",
  contextCards: focusCards, evidenceSourceIds: [], focusId: focusCards[1]!.contextCardId,
});
assert.equal(cached.cached, true);
assert.equal(cached.attempts, 0);
assert.equal(providerCalls, callsBeforeCacheHit, "an unchanged focused question must not call the provider again");
assert.equal((await modelCalls.listByTrace(documentId, cacheHitTurnId)).length, 0, "a cache hit must not create a model-call attempt");

await service.answer({
  documentId, expectedRevisionId: revisionId, turnId: randomUUID(), message: "换一个无关问题。",
  contextCards: focusCards, evidenceSourceIds: [], ignoreAmbiguousFocus: true,
});
assert.equal(lastContextCardCount, 0, "new prose after ignored ambiguity must use focus none");

const admittedContext = [{ sourceAlias: "D1", sourceType: "document_selection" as const, label: "研究意义", excerpt: "受控正文" }];
const grounded = validateGrantAssistantGroundedAnswer({
  content: "该判断来自选区。",
  admittedContext,
  claims: [{ claimId: "C1", statement: "该判断来自选区。", citationIds: ["R1"] }],
  citations: [{ citationId: "R1", sourceAlias: "D1" }],
});
assert.equal(grounded.grounding, "evidence_grounded");
assert.equal(grounded.citations[0]?.label, "研究意义");
assert.deepEqual(grounded.referencedObjects, [{ sourceAlias: "D1", sourceType: "document_selection", label: "研究意义" }]);
assert.deepEqual(grounded.unsupportedClaims, []);
assert.deepEqual(grounded.warnings, []);
assert.throws(() => validateGrantAssistantGroundedAnswer({
  content: "伪造来源",
  admittedContext,
  claims: [{ claimId: "C1", statement: "伪造来源", citationIds: ["R1"] }],
  citations: [{ citationId: "R1", sourceAlias: "D99" }],
}), GrantAssistantGroundingError);
assert.throws(() => validateGrantAssistantGroundedAnswer({
  content: "模型试图把有上下文的回答降级成普通讨论。",
  admittedContext,
  claims: [],
  citations: [],
}), GrantAssistantGroundingError);
assert.throws(() => validateGrantAssistantGroundedAnswer({
  content: "模型试图在无上下文时声明引用。",
  admittedContext: [],
  claims: [{ claimId: "C1", statement: "不存在的依据", citationIds: ["R1"] }],
  citations: [{ citationId: "R1", sourceAlias: "D1" }],
}), GrantAssistantGroundingError);

const general = validateGrantAssistantGroundedAnswer({
  content: "这是普通讨论。",
  admittedContext: [],
  claims: [],
  citations: [],
});
assert.deepEqual(general, {
  content: "这是普通讨论。",
  grounding: "general_reasoning",
  claims: [],
  citations: [],
  referencedObjects: [],
  suggestedActions: [],
});

assert.equal(normalizeGrantAssistantQuestion("  为什么   这样修改？ "), "为什么 这样修改?");
assert.equal(
  grantAssistantCacheKey({ question: "问题", sourceRevisionId: revisionId, policyVersion: "v1", modelId: "gpt-test", focus: null }),
  grantAssistantCacheKey({ question: " 问题 ", sourceRevisionId: revisionId, policyVersion: "v1", modelId: "gpt-test", focus: null }),
);
const recommended = grantCandidateRecommendedQuestions({
  diff: computeGrantCandidateDiff({ oldText: "第一段。\n第二段。", newText: "第一段修改。\n新增段落。" }),
  safetyState: "needs_confirmation",
  blockingIssues: [{ code: "unbound_claim" }],
});
assert.equal(recommended[0], "这版目前有哪些事实或安全风险？");
assert.ok(recommended.includes("为什么这样修改？"));
assert.ok(recommended.length <= 4);

const routeSource = await readFile(new URL("../app/api/grants/documents/[id]/assistant/chat/route.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../components/grants/grant-assistant-chat-panel.tsx", import.meta.url), "utf8");
const gatewaySource = await readFile(new URL("../lib/grants/application/grant-model-data-gateway.ts", import.meta.url), "utf8");
const providerSource = await readFile(new URL("../lib/grants/infrastructure/model/openai-grant-ai-model.ts", import.meta.url), "utf8");
const modelCallContractSource = await readFile(new URL("../lib/grants/model-execution/contracts.ts", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../supabase/migrations/055_grant_assistant_chat_model_calls.sql", import.meta.url), "utf8");
const sessionMigrationSource = await readFile(new URL("../supabase/migrations/056_grant_assistant_sessions.sql", import.meta.url), "utf8");
const configSource = await readFile(new URL("../lib/grants/server/config.ts", import.meta.url), "utf8");
assert.match(routeSource, /requireGrantAssistantChatRequestContext/);
assert.match(routeSource, /Cache-Control.*no-store/);
assert.match(routeSource, /message: z\.string\(\)/);
assert.doesNotMatch(routeSource, /messages: z\.array/);
assert.match(routeSource, /contextCards: z\.array\(GrantAssistantDocumentSelectionContextSchema\)/);
assert.match(panelSource, /对话已安全保存/);
assert.match(panelSource, /method: "GET"|assistant\/chat/);
assert.match(panelSource, /上方引用的正文会作为本轮依据/);
assert.match(panelSource, /GrantAssistantSourceControls/);
assert.match(panelSource, /crypto\.randomUUID/);
assert.match(panelSource, /contextCards/);
assert.match(panelSource, /recommendedQuestions/);
assert.match(gatewaySource, /answerAssistantChat/);
assert.match(providerSource, /zodResponseFormat\(AssistantChatResultSchema, "grant_assistant_chat"\)/);
assert.match(providerSource, /request\.admittedContext\.length === 0/);
assert.match(modelCallContractSource, /GRANT_ASSISTANT_CHAT_OPERATION/);
assert.match(modelCallContractSource, /expectedPolicy/);
assert.match(migrationSource, /operation IN \('grant\.edit_session\.turn', 'grant\.assistant\.chat'\)/);
assert.match(migrationSource, /grant-assistant-chat-v1/);
assert.match(sessionMigrationSource, /grant_assistant_sessions/);
assert.match(sessionMigrationSource, /grant_assistant_edit_session_links/);
assert.match(sessionMigrationSource, /UNIQUE\(session_id, turn_id, role\)/);
assert.match(sessionMigrationSource, /maintain_grant_assistant_sessions/);
assert.match(sessionMigrationSource, /INTERVAL '7 days'/);
assert.match(sessionMigrationSource, /INTERVAL '90 days'/);
assert.match(configSource, /GRANT_ASSISTANT_CHAT_DATABASE_SCHEMA\?\.trim\(\) === "056"/);

console.log("Grant assistant ordinary-chat execution contracts passed.");
