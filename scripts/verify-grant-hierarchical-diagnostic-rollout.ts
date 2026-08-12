import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GrantHierarchicalDiagnosticRolloutPolicySchema,
  selectGrantHierarchicalDiagnosticRollout,
} from "../lib/grants/diagnostics/hierarchical-rollout.ts";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";

assert.deepEqual(selectGrantHierarchicalDiagnosticRollout({
  ownerId: ownerA,
  policy: { mode: "off", databaseSchemaVersion: "047", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "disabled" });

assert.deepEqual(selectGrantHierarchicalDiagnosticRollout({
  ownerId: ownerA,
  policy: { mode: "canary", databaseSchemaVersion: "not_ready", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "database_not_ready" });

assert.deepEqual(selectGrantHierarchicalDiagnosticRollout({
  ownerId: ownerB,
  policy: { mode: "canary", databaseSchemaVersion: "047", canaryOwnerIds: [ownerA] },
}), { selected: false, reason: "canary_not_selected" });

assert.deepEqual(selectGrantHierarchicalDiagnosticRollout({
  ownerId: ownerA,
  policy: { mode: "canary", databaseSchemaVersion: "047", canaryOwnerIds: [ownerA] },
}), { selected: true, reason: "canary_selected" });

assert.deepEqual(selectGrantHierarchicalDiagnosticRollout({
  ownerId: ownerB,
  policy: { mode: "on", databaseSchemaVersion: "047", canaryOwnerIds: [] },
}), { selected: true, reason: "enabled" });

assert.throws(() => GrantHierarchicalDiagnosticRolloutPolicySchema.parse({
  mode: "canary",
  databaseSchemaVersion: "047",
  canaryOwnerIds: ["not-a-user-id"],
}));

const [composition, config, service, checker, route, migration] = await Promise.all([
  readFile("lib/grants/server/composition.ts", "utf8"),
  readFile("lib/grants/server/config.ts", "utf8"),
  readFile("lib/grants/application/diagnostic-service.ts", "utf8"),
  readFile("lib/grants/application/semantic-diagnostic-checker.ts", "utf8"),
  readFile("app/api/grants/documents/[id]/diagnostics/route.ts", "utf8"),
  readFile("supabase/migrations/047_grant_hierarchical_diagnostic_projection.sql", "utf8"),
]);

assert.match(composition, /selectGrantSemanticDiagnosticRuntime\(ownerId\)/);
assert.match(config, /isGrantHierarchicalDiagnosticSelected\(ownerId\)/);
assert.match(composition, /new GrantSemanticDiagnosticChecker/);
assert.doesNotMatch(composition, /new GrantDiagnosticService[\s\S]*new GrantDiagnosticService/);
assert.match(checker, /findArgumentMapCheckpoint/);
assert.match(checker, /GrantHierarchicalSemanticCheckerError/);
assert.match(service, /saveArgumentMapCheckpoint/);
assert.match(service, /saveHierarchicalExecution/);
assert.match(service, /assembleGrantHierarchicalExecutionForPersistenceV1/);
assert.match(route, /diagnostics\.run/);
assert.doesNotMatch(route, /hierarchical/i, "The existing diagnostics route must remain the only HTTP authority.");
assert.match(migration, /diagnostic_base_revision_stale/);
assert.match(migration, /save_grant_hierarchical_diagnostic_execution/);

console.log("Grant hierarchical diagnostic fail-closed rollout contracts passed.");
