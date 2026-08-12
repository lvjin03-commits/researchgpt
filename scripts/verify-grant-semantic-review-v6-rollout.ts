import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GrantSemanticReviewV6RolloutPolicySchema,
  selectGrantSemanticReviewV6Rollout,
} from "../lib/grants/diagnostics/semantic-review-v6-rollout.ts";
import { selectGrantSemanticDiagnosticRuntime } from "../lib/grants/server/config.ts";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

assert.deepEqual(selectGrantSemanticReviewV6Rollout({
  ownerId: ownerA,
  policy: { mode: "off", databaseSchemaVersion: "051", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "disabled" });
assert.deepEqual(selectGrantSemanticReviewV6Rollout({
  ownerId: ownerA,
  policy: { mode: "canary", databaseSchemaVersion: "not_ready", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "database_not_ready" });
assert.deepEqual(selectGrantSemanticReviewV6Rollout({
  ownerId: ownerB,
  policy: { mode: "canary", databaseSchemaVersion: "051", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "canary_not_selected" });
assert.deepEqual(selectGrantSemanticReviewV6Rollout({
  ownerId: ownerA,
  policy: { mode: "canary", databaseSchemaVersion: "051", canaryOwnerIds: [ownerA] },
}), { selected: true, reason: "canary_selected" });
assert.deepEqual(selectGrantSemanticReviewV6Rollout({
  ownerId: ownerB,
  policy: { mode: "on", databaseSchemaVersion: "051", canaryOwnerIds: [] },
}), { selected: true, reason: "enabled" });
assert.throws(() => GrantSemanticReviewV6RolloutPolicySchema.parse({
  mode: "canary", databaseSchemaVersion: "051", canaryOwnerIds: ["not-a-user-id"],
}));

const savedEnv = { ...process.env };
function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
  delete process.env.GRANT_SEMANTIC_REVIEW_V6_MODE;
  delete process.env.GRANT_SEMANTIC_REVIEW_V6_DATABASE_SCHEMA;
  delete process.env.GRANT_SEMANTIC_REVIEW_V6_CANARY_OWNER_IDS;
  delete process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_MODE;
  delete process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_DATABASE_SCHEMA;
  delete process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_CANARY_OWNER_IDS;
  delete process.env.GRANT_SEMANTIC_DIAGNOSTIC_V3_ENABLED;
}

resetEnv();
assert.equal(selectGrantSemanticDiagnosticRuntime(ownerA), "v2", "V6 must be off by default.");
process.env.GRANT_SEMANTIC_DIAGNOSTIC_V3_ENABLED = "true";
assert.equal(selectGrantSemanticDiagnosticRuntime(ownerA), "v3", "Existing V3 fallback must remain unchanged.");
process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_MODE = "on";
process.env.GRANT_HIERARCHICAL_DIAGNOSTIC_DATABASE_SCHEMA = "047";
assert.equal(selectGrantSemanticDiagnosticRuntime(ownerA), "hierarchical", "Existing hierarchical selection must remain unchanged.");
process.env.GRANT_SEMANTIC_REVIEW_V6_MODE = "on";
assert.equal(selectGrantSemanticDiagnosticRuntime(ownerA), "hierarchical", "V6 code flag without DB 051 must fail closed.");
process.env.GRANT_SEMANTIC_REVIEW_V6_DATABASE_SCHEMA = "051";
assert.equal(selectGrantSemanticDiagnosticRuntime(ownerA), "v6", "Ready V6 must be selected by the sole runtime authority.");
resetEnv();

const [composition, checker, service, gateway, route] = await Promise.all([
  readFile("lib/grants/server/composition.ts", "utf8"),
  readFile("lib/grants/application/semantic-diagnostic-checker.ts", "utf8"),
  readFile("lib/grants/application/diagnostic-service.ts", "utf8"),
  readFile("lib/grants/application/grant-model-data-gateway.ts", "utf8"),
  readFile("app/api/grants/documents/[id]/diagnostics/route.ts", "utf8"),
]);
assert.match(composition, /selectGrantSemanticDiagnosticRuntime\(ownerId\)/);
assert.doesNotMatch(composition, /isGrantSemanticReviewV6Selected/);
assert.match(checker, /semanticReviewV6/);
assert.match(checker, /findSemanticReviewV6Checkpoint/);
assert.match(gateway, /executeDiagnosticSemanticReviewV6Input/);
assert.match(service, /saveSemanticReviewV6Execution/);
assert.match(service, /assembleGrantSemanticReviewV6ExecutionForPersistence/);
assert.match(route, /diagnostics\.run/);
assert.doesNotMatch(route, /semanticReviewV6|GRANT_SEMANTIC_REVIEW_V6/i,
  "The existing diagnostics route must not select V6 itself.");

console.log("Grant Semantic Review V6 fail-closed runtime-selection contracts passed.");
