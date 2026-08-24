import assert from "node:assert/strict";
import { PointStatementService } from "../lib/billing/application/statement-service.ts";
import type { PointStatementRepository } from "../lib/billing/ports/statement-repository.ts";

const calls: Array<Parameters<PointStatementRepository["getStatement"]>[0]> = [];
const repository: PointStatementRepository = {
  async getStatement(input) {
    calls.push(input);
    return { availablePoints: 20, reservedPoints: 3, lifetimeSpentPoints: 7, entries: [], nextCursor: null };
  },
};

const service = new PointStatementService(repository);
await service.getStatement({
  ownerId: "00000000-0000-4000-8000-000000000001",
  cursor: "cursor",
  limit: 8,
  kind: "settle",
});
assert.deepEqual(calls[0], {
  ownerId: "00000000-0000-4000-8000-000000000001",
  cursor: "cursor",
  limit: 8,
  kind: "settle",
});

assert.throws(
  () => service.getStatement({ ownerId: "owner", limit: 101 }),
  /between 1 and 100/,
);
assert.throws(
  () => service.getStatement({ ownerId: "owner", kind: "other" as "settle" }),
);

console.log("Account statement service contracts passed.");
