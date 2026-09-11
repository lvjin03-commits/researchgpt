import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createResumableWebAnswerBudget } from "../lib/billing/domain/resumable-web-answer-budget.ts";
import { GrantWebBudgetCommandService } from "../lib/grants/application/grant-web-budget-commands.ts";
import { applyGrantWebCheckpointArtifact } from "../lib/grants/application/grant-web-resumable-flow.ts";
import type { GrantWebResumableCheckpoint } from "../lib/grants/web-sources/resumable-checkpoint.ts";

const state = createResumableWebAnswerBudget({ budgetId: randomUUID(), ownerId: randomUUID(),
  documentId: randomUUID(), turnId: randomUUID(), authorizationId: randomUUID(), authorizedPoints: 100,
  decisionHardMaximumPoints: 5, deliveryHardMaximumPoints: 15 });
const checkpoint: GrantWebResumableCheckpoint = { schemaVersion: 1, documentId: state.documentId,
  turnId: state.turnId, assistantSessionId: randomUUID(), question: "What changed?", sourceRevision: 1,
  contextHash: "a".repeat(64), authorizationFingerprint: "b".repeat(64),
  query: null, search: null, assessment: null, answer: null };
const operations: string[] = [];
const continuation = new GrantWebBudgetCommandService({
  async create(next) { return next; }, async get() { return null; },
  async authorizeIncrease(_previous, _id, _points, next) { return next; },
  async transition(_previous, next) { return next; },
}, undefined, { async getProtectedDeliveryMaximumPoints() { return 15; }, async execute(input) {
  operations.push(input.operation);
  if (input.operation === "query_rewrite") return { status: "advanced" as const, state: input.state,
    checkpoint: applyGrantWebCheckpointArtifact(input.checkpoint, { operation: "query_rewrite", value: { query: "zinc" } }) };
  return { status: "awaiting_budget" as const, state: input.state, checkpoint: input.checkpoint,
    requiredAdditionalPoints: 7 };
} });
const paused = await continuation.resume({ state, checkpoint, mode: "continue_research" });
assert.equal(paused.status, "awaiting_budget");
assert.deepEqual(operations, ["query_rewrite", "search_query"]);
console.log("Grant web continuation resumes from checkpoints and stops on budget pause.");
