import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantCandidateExplanationService, GrantCandidateExplanationError } from "../lib/grants/application/grant-candidate-explanation-service.ts";
import { GrantModelExecutor } from "../lib/grants/application/grant-model-executor.ts";
import { sha256Canonical } from "../lib/grants/domain/canonical-json.ts";
import { GrantAiEditCandidateSchema, GrantAiEditSessionSchema } from "../lib/grants/edit-session/contracts.ts";
import { buildGrantCandidateExplanationContext, GrantCandidateExplanationContextBudgetError } from "../lib/grants/edit-session/candidate-explanation-context.ts";
import { InMemoryGrantAiEditSessionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-ai-edit-session-repository.ts";
import { InMemoryGrantCandidateExplanationRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-candidate-explanation-repository.ts";
import { InMemoryGrantModelCallRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-model-call-repository.ts";
import { grantTextHash } from "../lib/grants/patching/patch-policy.ts";

const documentId = randomUUID();
const sessionId = randomUUID();
const candidateId = randomUUID();
const turnId = randomUUID();
const revisionId = randomUUID();
const nodeId = randomUUID();
const actorId = randomUUID();
const sourceId = randomUUID();
const cardId = randomUUID();
const originalText = "本项目研究锌负极界面。";
const candidateText = "本项目聚焦锌负极界面的动态演化。";
const now = "2026-08-17T12:00:00.000Z";
const repository = new InMemoryGrantAiEditSessionRepository();
await repository.createSession(GrantAiEditSessionSchema.parse({
  sessionId, documentId, baseRevisionId: revisionId, targetNodeId: nodeId,
  expectedNodeHash: grantTextHash(originalText), editMode: "replace", status: "active",
  activeCandidateId: candidateId, lastSafeCandidateId: candidateId,
  createdBy: actorId, createdAt: now, lastActiveAt: now,
}));
const candidate = GrantAiEditCandidateSchema.parse({
  candidateId, sessionId, producedByTurnId: turnId, text: candidateText,
  textHash: grantTextHash(candidateText), safetyState: "blocked",
  factCheck: {
    policyVersion: "grant-edit-fact-check-v1", claims: [], bindings: [],
    issues: [{ code: "claim_binding_missing" }], state: "blocked",
  },
  context: { evidenceBindings: [{
    sourceId, cardId, authorizationRevision: 1, sourceTitle: "已撤权资料",
    provenanceType: "published_literature", sourceContentHash: sha256Canonical("source"),
    excerptHash: sha256Canonical("excerpt"), uses: ["model", "reasoning"],
  }] },
  provider: "openai", modelId: "gpt-test", createdAt: now,
});
await repository.createTurn({
  turnId, sessionId, traceId: randomUUID(), instruction: "优化表达", status: "running", createdAt: now,
});
await repository.completeTurnWithCandidate({ turnId, completedAt: now, candidate });

let providerCalls = 0;
const modelCalls = new InMemoryGrantModelCallRepository();
const explanations = new InMemoryGrantCandidateExplanationRepository();
const service = new GrantCandidateExplanationService({
  repository,
  revisionService: { getRevision: async () => ({ snapshot: { nodes: [{ nodeId, nodeType: "paragraph", content: { text: originalText } }] } }) } as never,
  modelGateway: {
    inspectCandidateExplanationSources: async () => [{
      sourceId, sourceTitle: "已撤权资料", usedWhenGenerated: true as const,
      currentlyAuthorized: false, status: "revoked" as const,
    }],
    explainEditCandidate: async (request) => {
      providerCalls += 1;
      if (providerCalls === 1) return {
        summary: "错误索引", changes: [{ changeIndex: 99, explanation: "错误" }], cautions: [],
        provider: "openai" as const, modelId: "gpt-test",
      };
      return {
        summary: "将研究对象表述得更具体。",
        changes: request.diff.changes.map((_, changeIndex) => ({ changeIndex, explanation: "说明程序识别出的文字变化。" })),
        cautions: ["资料当前已撤权。"], provider: "openai" as const, modelId: "gpt-test",
        providerRequestId: "req_explain", usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 1 },
      };
    },
  },
  modelExecutor: new GrantModelExecutor(modelCalls),
  explanationRepository: explanations,
  configuredGrantModelId: "gpt-test",
  now: () => now,
  classifyFailure: (error) => (error as { category?: "structured_reference_invalid" }).category ?? "unknown_provider_failure",
});

const before = await repository.getSession(sessionId);
const preview = await service.getDiff({ documentId, sessionId, candidateId });
assert.equal(preview.candidateId, candidateId);
assert.ok(preview.diff.changes.length > 0);
assert.equal(providerCalls, 0, "viewing the program Diff must not call the provider");
const requiredContextSize = JSON.stringify({ diff: preview.diff, blockingIssues: preview.blockingIssues }).length;
const trimmedContext = buildGrantCandidateExplanationContext({
  diff: preview.diff, blockingIssues: preview.blockingIssues,
  sources: [{ sourceTitle: "A".repeat(500), currentlyAuthorized: true, status: "current" }],
  maximumCharacters: requiredContextSize + 10,
});
assert.equal(trimmedContext.budget.omittedSourceCount, 1, "low-priority source descriptions trim before required Diff and blocking issues");
assert.throws(() => buildGrantCandidateExplanationContext({
  diff: preview.diff, blockingIssues: preview.blockingIssues, sources: [], maximumCharacters: requiredContextSize - 1,
}), GrantCandidateExplanationContextBudgetError);
const result = await service.explain({ documentId, sessionId, candidateId });
assert.equal(result.attempts, 2);
assert.equal(providerCalls, 2);
assert.equal(result.explanation.summary, "将研究对象表述得更具体。");
assert.equal(result.explanation.diffHash, result.diff.diffHash);
assert.equal(result.explanation.blockingIssues[0]?.code, "claim_binding_missing");
assert.equal(result.explanation.sources[0]?.currentlyAuthorized, false);
assert.equal(result.explanation.sources[0]?.status, "revoked");
assert.deepEqual(await repository.getSession(sessionId), before, "explanation must not mutate the Edit Session");
assert.deepEqual((await modelCalls.listByTrace(documentId, result.traceId)).map((call) => [call.operation, call.status]), [
  ["grant.edit_candidate.explain", "failed"],
  ["grant.edit_candidate.explain", "succeeded"],
]);

const cached = await service.explain({ documentId, sessionId, candidateId });
assert.equal(cached.cacheHit, true);
assert.equal(cached.attempts, 0);
assert.equal(cached.cacheKey, result.cacheKey);
assert.equal(providerCalls, 2, "an unchanged explanation cache hit must not call the provider");
assert.equal((await modelCalls.listByTrace(documentId, result.traceId)).length, 2, "a cache hit must not create a model-call attempt");

const singleFlight = new InMemoryGrantCandidateExplanationRepository();
const flightInput = { cacheKey: sha256Canonical("flight"), documentId, sessionId, candidateId, diffHash: result.diff.diffHash, traceId: randomUUID(), claimedAt: now, leaseExpiresAt: "2026-08-17T12:02:00.000Z" };
assert.deepEqual(await singleFlight.claim(flightInput), { state: "acquired" });
assert.deepEqual(await singleFlight.claim({ ...flightInput, traceId: randomUUID() }), { state: "in_progress" });

await assert.rejects(
  service.explain({ documentId, sessionId, candidateId: randomUUID() }),
  (error) => error instanceof GrantCandidateExplanationError && error.code === "candidate_not_found",
);
assert.equal(providerCalls, 2, "invalid Candidate identity must fail before provider dispatch");

const serviceSource = await readFile(new URL("../lib/grants/application/grant-candidate-explanation-service.ts", import.meta.url), "utf8");
const migrationSource = await readFile(new URL("../supabase/migrations/057_grant_candidate_explanation_model_calls.sql", import.meta.url), "utf8");
const cacheMigrationSource = await readFile(new URL("../supabase/migrations/058_grant_candidate_explanation_cache.sql", import.meta.url), "utf8");
const configSource = await readFile(new URL("../lib/grants/server/config.ts", import.meta.url), "utf8");
const providerSource = await readFile(new URL("../lib/grants/infrastructure/model/openai-grant-ai-model.ts", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/grants/documents/[id]/edit-sessions/[sessionId]/candidates/[candidateId]/explanation/route.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../components/grants/grant-ai-edit-session-panel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(serviceSource, /patchService|commitRevision|proposeApprovedCandidate|\.accept\(/);
assert.match(migrationSource, /grant\.edit_candidate\.explain/);
assert.match(migrationSource, /grant-edit-candidate-explain-v1/);
assert.match(cacheMigrationSource, /PRIMARY KEY/);
assert.match(cacheMigrationSource, /state','in_progress/);
assert.match(cacheMigrationSource, /lease_expires_at/);
assert.match(configSource, /GRANT_CANDIDATE_EXPLANATION_DATABASE_SCHEMA\?\.trim\(\) === "058"/);
assert.match(providerSource, /Describe only changes present in the supplied Diff/);
assert.match(providerSource, /Never omit, soften, or contradict a blocking issue/);
assert.match(routeSource, /export async function GET/);
assert.match(routeSource, /candidateExplanation\.getDiff/);
assert.match(routeSource, /export async function POST/);
assert.match(routeSource, /candidateExplanation\.explain/);
assert.match(routeSource, /Cache-Control.*no-store/);
assert.match(panelSource, /"查看差异"/);
assert.match(panelSource, /"解释修改"/);
assert.ok(panelSource.indexOf("此版本当前不能应用") < panelSource.indexOf("insight.explanation.summary"), "blocking issues must render before the shared summary");
assert.doesNotMatch(routeSource, /continueSession|applyActiveCandidate|patchService/);

console.log("Grant Candidate explanation operation verification passed.");
