import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ResumableWebAnswerBudgetCoordinator } from "../lib/billing/application/resumable-web-answer-budget-coordinator.ts";
import {
  admitResumableWebAnswerPhase,
  authorizeResumableWebAnswerBudgetIncrease,
  createResumableWebAnswerBudget,
  settleResumableWebAnswerPhase,
  waiveDecisionEnvelopeForDelivery,
} from "../lib/billing/domain/resumable-web-answer-budget.ts";

const create = (authorizedPoints = 50) => createResumableWebAnswerBudget({
  budgetId: randomUUID(), ownerId: randomUUID(), documentId: randomUUID(), turnId: randomUUID(),
  authorizationId: randomUUID(), authorizedPoints, decisionHardMaximumPoints: 5,
  deliveryHardMaximumPoints: 15,
});
const policy = "grant-web-test-v1";

assert.throws(() => create(19), /cannot protect/u);
let state = create();
const execution1 = randomUUID();
const admitted1 = admitResumableWebAnswerPhase({ state, phaseId: execution1, envelope: "execution", maximumChargePoints: 25, pricePolicyVersion: policy });
assert.equal(admitted1.decision, "admitted");
state = settleResumableWebAnswerPhase({ state: admitted1.state, phaseId: execution1, chargedPoints: 20 });
assert.equal(state.settledPoints, 20);

const execution2 = randomUUID();
const paused = admitResumableWebAnswerPhase({ state, phaseId: execution2, envelope: "execution", maximumChargePoints: 20, pricePolicyVersion: policy });
assert.equal(paused.decision, "awaiting_budget");
assert.equal(paused.requiredAdditionalPoints, 10, "20 settled + 20 active + 5 decision + 15 delivery needs 60 authorized");
assert.equal(paused.state.activePhase, null);
state = authorizeResumableWebAnswerBudgetIncrease({ state: paused.state, authorizationId: randomUUID(), additionalPoints: 10 });
assert.equal(state.authorizedPoints, 60);
assert.equal(admitResumableWebAnswerPhase({ state, phaseId: execution2, envelope: "execution", maximumChargePoints: 20, pricePolicyVersion: policy }).decision, "admitted");

let calls = 0;
let reservations = 0;
const coordinator = new ResumableWebAnswerBudgetCoordinator({
  async reserve() { reservations += 1; },
  async settle() {},
  async release() {},
});
const blocked = await coordinator.executePhase({ state: paused.state, phaseId: randomUUID(),
  envelope: "execution", maximumChargePoints: 20,
  pricePolicyVersion: policy,
  invoke: async () => { calls += 1; return { value: "must not execute", chargedPoints: 1 }; },
});
assert.equal(blocked.status, "awaiting_budget");
assert.equal(calls, 0, "budget rejection must happen before provider invocation");
assert.equal(reservations, 0, "budget rejection must happen before ledger reservation");

state = waiveDecisionEnvelopeForDelivery(paused.state);
const deliveryId = randomUUID();
const delivered = await coordinator.executePhase({ state, phaseId: deliveryId, envelope: "delivery",
  maximumChargePoints: 15,
  pricePolicyVersion: policy,
  invoke: async () => { calls += 1; return { value: "partial answer", chargedPoints: 12, deliveryOutcome: "partial" }; },
});
assert.equal(delivered.status, "completed");
assert.equal(delivered.state.status, "delivered_partial");
assert.equal(delivered.state.settledPoints, 32);
assert.equal(reservations, 1);
assert.equal(calls, 1);
assert.throws(() => admitResumableWebAnswerPhase({ state: delivered.state, phaseId: randomUUID(),
  envelope: "execution", maximumChargePoints: 1, pricePolicyVersion: policy }), /terminal/u);

const replayAuthorization = randomUUID();
const increasedOnce = authorizeResumableWebAnswerBudgetIncrease({ state: paused.state,
  authorizationId: replayAuthorization, additionalPoints: 10 });
const increasedReplay = authorizeResumableWebAnswerBudgetIncrease({ state: increasedOnce,
  authorizationId: replayAuthorization, additionalPoints: 10 });
assert.equal(increasedReplay.authorizedPoints, increasedOnce.authorizedPoints, "increase authorization must be idempotent");
assert.throws(() => authorizeResumableWebAnswerBudgetIncrease({ state: increasedOnce,
  authorizationId: replayAuthorization, additionalPoints: 11 }), /different amount/u);

let invalidSettlementCalls = 0;
const validationCoordinator = new ResumableWebAnswerBudgetCoordinator({
  async reserve() {},
  async settle() { invalidSettlementCalls += 1; },
  async release() {},
});
await assert.rejects(() => validationCoordinator.executePhase({ state: create(), phaseId: randomUUID(),
  envelope: "execution", maximumChargePoints: 10,
  pricePolicyVersion: policy,
  invoke: async () => ({ value: "invalid charge", chargedPoints: 11 }),
}), /exceeds its admitted maximum/u);
assert.equal(invalidSettlementCalls, 0, "invalid provider charges must be rejected before ledger settlement");

console.log("Resumable web-answer pre-dispatch budget state machine passed.");
