import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GrantWebBudgetCommandService } from "../lib/grants/application/grant-web-budget-commands.ts";
import { admitResumableWebAnswerPhase,
  createResumableWebAnswerBudget } from "../lib/billing/domain/resumable-web-answer-budget.ts";
import type { GrantWebResumableCheckpoint } from "../lib/grants/web-sources/resumable-checkpoint.ts";

let state = createResumableWebAnswerBudget({ budgetId: randomUUID(), ownerId: randomUUID(),
  documentId: randomUUID(), turnId: randomUUID(), authorizationId: randomUUID(),
  authorizedPoints: 20, decisionHardMaximumPoints: 5, deliveryHardMaximumPoints: 15 });
const phaseId = randomUUID();
const admitted = admitResumableWebAnswerPhase({ state, phaseId, envelope: "execution",
  maximumChargePoints: 10, pricePolicyVersion: "test-v1" });
assert.equal(admitted.decision, "awaiting_budget");
state = admitted.state;
const writes: string[] = [];
const commands = new GrantWebBudgetCommandService({
  async create(next) { return next; },
  async get() { return { state, checkpoint: null }; },
  async authorizeIncrease(_previous, _id, _points, next) { writes.push("increase"); return next; },
  async transition(_previous, next) { writes.push("transition"); return next; },
});
const increased = await commands.increase({ state, command: { budgetId: state.budgetId,
  expectedVersion: state.version, authorizationId: randomUUID(), additionalPoints: 10 } });
assert.equal(increased.authorizedPoints, 30);
await assert.rejects(() => commands.increase({ state, command: { budgetId: state.budgetId,
  expectedVersion: state.version - 1, authorizationId: randomUUID(), additionalPoints: 10 } }), /stale/u);

const checkpoint: GrantWebResumableCheckpoint = { schemaVersion: 1, documentId: state.documentId,
  turnId: state.turnId, assistantSessionId: randomUUID(), question: "What changed?", sourceRevision: 1,
  contextHash: "a".repeat(64),
  authorizationFingerprint: "b".repeat(64), query: { query: "zinc battery" },
  search: { searchAuditId: randomUUID(), sources: [{ schemaVersion: 1, sourceId: randomUUID(),
    providerId: "openai_web_search", providerRecordId: null, canonicalUrl: "https://example.edu/x",
    title: "Result", snippet: "Useful result", publishedAt: null, retrievedAt: new Date().toISOString(),
    contentFingerprint: "c".repeat(64), classification: { qualityTier: "university_research",
      registryVersion: "v1", ruleId: "edu", reason: "domain_rule" } }] }, assessment: null, answer: null };
const pausedCommands = new GrantWebBudgetCommandService({
  async create(next) { return next; },
  async get() { return null; },
  async getLatestPausedForDocument(documentId) {
    assert.equal(documentId, state.documentId);
    return { state, checkpoint };
  },
  async authorizeIncrease(_previous, _id, _points, next) { return next; },
  async transition(_previous, next) { return next; },
});
assert.deepEqual(await pausedCommands.getPaused(state.documentId), {
  budgetId: state.budgetId, turnId: state.turnId, version: state.version,
  requiredAdditionalPoints: state.requiredAdditionalPoints,
  settledPoints: state.settledPoints, authorizedPoints: state.authorizedPoints,
  question: checkpoint.question, canDeliverExisting: true,
});
const delivery = await commands.deliverExisting({ state, checkpoint, command: {
  budgetId: state.budgetId, expectedVersion: state.version } });
assert.equal(delivery.nextOperation, "existing_results_delivery");
assert.equal(delivery.sources.length, 1);
assert.deepEqual(writes, ["increase", "transition"]);

const completedCheckpoint: GrantWebResumableCheckpoint = {
  ...checkpoint,
  assessment: { assessments: checkpoint.search!.sources.map((source) => ({
    sourceId: source.sourceId, disposition: "recommended", reason: "Relevant",
  })) },
  answer: { claims: [{ claimId: randomUUID(), statement: "A grounded current result.",
    sourceIds: [checkpoint.search!.sources[0]!.sourceId] }] },
};
let savedTurn = "";
const resumable = new GrantWebBudgetCommandService({
  async create(next) { return next; },
  async get() { return { state, checkpoint: completedCheckpoint }; },
  async authorizeIncrease(_previous, _id, _points, next) { return next; },
  async transition(_previous, next) { return next; },
}, undefined, {
  async execute({ state: next }) { return { status: "completed", state: next,
    checkpoint: completedCheckpoint, answer: completedCheckpoint.answer }; },
  async getProtectedDeliveryMaximumPoints() { return 15; },
}, async ({ checkpoint: savedCheckpoint, answer }) => {
  savedTurn = savedCheckpoint.turnId;
  assert.equal(answer.content, "A grounded current result. [W1]");
});
await resumable.increaseStored({ documentId: state.documentId, command: { budgetId: state.budgetId,
  expectedVersion: state.version, authorizationId: randomUUID(), additionalPoints: 10 } });
assert.equal(savedTurn, state.turnId, "A resumed answer must be persisted through the completion sink.");

console.log("Grant web budget increase and deliver-existing commands passed.");
