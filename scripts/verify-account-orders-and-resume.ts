import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PointPaymentQueryService } from "../lib/billing/application/payment-query-service.ts";
import { ResumeIntentService } from "../lib/billing/application/resume-intent-service.ts";
import type { ResumeIntent } from "../lib/billing/domain/resume-intents.ts";
import type { ResumeIntentRepository } from "../lib/billing/ports/resume-intent-repository.ts";

const queryCalls: unknown[] = [];
const query = new PointPaymentQueryService({
  async listOrders(input) {
    queryCalls.push(input);
    return { orders: [], nextCursor: null };
  },
});
await query.listOrders({ ownerId: "owner", limit: 12, status: "reversed" });
assert.deepEqual(queryCalls[0], { ownerId: "owner", cursor: null, limit: 12, status: "reversed" });
assert.throws(() => query.listOrders({ ownerId: "owner", status: "unknown" }), /Unknown/);

let stored: ResumeIntent | null = null;
const repository: ResumeIntentRepository = {
  async create(input) {
    stored = { ...input, status: "awaiting_payment", revalidatedAt: null, consumedAt: null };
    return stored;
  },
  async get() { return stored; },
  async transition(input) {
    assert.ok(stored && input.from.includes(stored.status));
    stored = {
      ...stored,
      status: input.to,
      revalidatedAt: input.to === "ready" || input.to === "stale" ? input.now : stored.revalidatedAt,
      consumedAt: input.to === "consumed" ? input.now : stored.consumedAt,
    };
    return stored;
  },
};
const service = new ResumeIntentService(
  repository,
  () => "00000000-0000-4000-8000-000000000002",
  () => new Date("2026-08-24T12:00:00.000Z"),
);
const intent = await service.create({
  ownerId: "00000000-0000-4000-8000-000000000001",
  operation: "grant.edit_session.turn",
  requiredPoints: 25,
  context: {
    sourcePath: "/grants/example",
    documentId: null,
    editSessionId: null,
    candidateId: null,
    instructionDraft: "继续优化",
    baselineHash: null,
  },
});
assert.equal(intent.status, "awaiting_payment");
stored = { ...intent, status: "needs_revalidation" };
const ready = await service.revalidate({
  resumeIntentId: intent.resumeIntentId,
  ownerId: intent.ownerId,
  validator: { async validate() { return { valid: true }; } },
});
assert.equal(ready.status, "ready");
assert.equal((await service.consume({ resumeIntentId: intent.resumeIntentId, ownerId: intent.ownerId })).status, "consumed");

const migration = await readFile(new URL("../supabase/migrations/066_payment_orders_and_resume_intents.sql", import.meta.url), "utf8");
assert.match(migration, /status='needs_revalidation'/);
assert.match(migration, /AFTER UPDATE OF status/);
assert.match(migration, /transition_resume_intent\(UUID,UUID,TEXT\[\],TEXT,TIMESTAMPTZ\) TO service_role/);
assert.doesNotMatch(migration, /transition_resume_intent\(UUID,UUID,TEXT\[\],TEXT,TIMESTAMPTZ\) TO authenticated/);
assert.doesNotMatch(migration, /execute.*operation/i);

console.log("Account order projection and resume-intent contracts passed.");
