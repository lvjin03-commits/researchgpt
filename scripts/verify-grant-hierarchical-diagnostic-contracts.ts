import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentMapProviderResultV1Schema,
  GrantArgumentMapV1Schema,
  GrantArgumentRoleSchema,
  GrantHierarchicalDiagnosticStageStateSchema,
  GrantOccurrenceContinuityIdentityV1Schema,
  GrantRootContinuityIdentityV1Schema,
  GrantRootDiagnosticProviderResultV1Schema,
} from "../lib/grants/diagnostics/hierarchical-semantic-contracts.ts";
import { GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION } from "../lib/grants/ports/grant-diagnostic-model.ts";

const forbiddenProviderKeywords = new Set([
  "default", "format", "pattern", "minLength", "maxLength", "minimum",
  "maximum", "minItems", "maxItems",
]);

function assertStrictProviderSchema(value: unknown, path = "$schema"): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const keyword of forbiddenProviderKeywords) {
    assert.equal(keyword in record, false, `${path} must not use ${keyword}`);
  }
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false, `${path} must reject additional properties`);
    const propertyNames = Object.keys((record.properties ?? {}) as Record<string, unknown>);
    assert.deepEqual(record.required, propertyNames, `${path} must require every property`);
  }
  for (const [key, child] of Object.entries(record)) assertStrictProviderSchema(child, `${path}.${key}`);
}

for (const [schema, name] of [
  [GrantArgumentMapProviderResultV1Schema, "grant_argument_map_v1"],
  [GrantRootDiagnosticProviderResultV1Schema, "grant_root_diagnostic_v1"],
] as const) {
  const responseFormat = zodResponseFormat(schema, name);
  assert.equal(responseFormat.type, "json_schema");
  assert.equal(responseFormat.json_schema.strict, true);
  assertStrictProviderSchema(responseFormat.json_schema.schema);
}

assert.equal(GRANT_DIAGNOSTIC_V3_SCHEMA_VERSION, "grant-semantic-diagnostic-v4");
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerSchemaVersion, "grant-semantic-diagnostic-v5");
assert.equal(GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerContractVersion,
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.providerSchemaVersion);

const sourceRevisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const modules = GrantArgumentRoleSchema.options.map((role) => ({
  role,
  presence: role === "central_hypothesis" ? "missing" as const : "explicit" as const,
  statement: role === "central_hypothesis" ? null : `${role} statement`,
  sourceLocations: role === "central_hypothesis" ? [] : [{ sectionId, nodeId }],
}));
assert.doesNotThrow(() => GrantArgumentMapV1Schema.parse({
  schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
  sourceRevisionId,
  modules,
  relations: [],
}));
assert.throws(() => GrantArgumentMapV1Schema.parse({
  schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
  sourceRevisionId,
  modules: modules.slice(1),
  relations: [],
}));

const providerMapWithDiagnosis = {
  modules: GrantArgumentRoleSchema.options.map((role) => ({
    role,
    presence: "missing",
    statement: null,
    sourceLocationRefs: [],
  })),
  relations: [],
  diagnosis: "This field belongs to step B.",
};
assert.throws(() => GrantArgumentMapProviderResultV1Schema.parse(providerMapWithDiagnosis));

const rootProviderResult = {
  rootFindings: [{
    category: "argument_chain_gap",
    affectedArgumentRoles: ["knowledge_gap", "scientific_question"],
    title: "The gap is not connected to the scientific question",
    diagnosticFact: "The application moves from a literature gap to a material recipe.",
    reason: "The missing inference prevents the proposed route from answering a bounded question.",
    recommendation: "State the unknown relationship before presenting the material strategy.",
    possibleConsequence: null,
    assessment: { scope: "cross_section", confidence: 0.9, actionability: "requires_expert_judgment" },
    occurrences: [{ primaryLocationRef: "N1", relatedLocations: [] }],
    evidenceBasis: "document_only",
    usedEvidenceCardIds: [],
  }],
};
assert.doesNotThrow(() => GrantRootDiagnosticProviderResultV1Schema.parse(rootProviderResult));
assert.throws(() => GrantRootDiagnosticProviderResultV1Schema.parse({
  rootFindings: [{ ...rootProviderResult.rootFindings[0], severity: "high" }],
}));

const occurrenceIdentity = {
  checkerId: "grant-semantic-argument-diagnostic",
  checkerVersion: "5.0.0",
  category: "argument_chain_gap",
  primaryNodeId: nodeId,
  relatedLocations: [],
};
assert.doesNotThrow(() => GrantOccurrenceContinuityIdentityV1Schema.parse(occurrenceIdentity));
assert.throws(() => GrantOccurrenceContinuityIdentityV1Schema.parse({
  ...occurrenceIdentity,
  locationRef: "N1",
}));
assert.throws(() => GrantOccurrenceContinuityIdentityV1Schema.parse({
  ...occurrenceIdentity,
  diagnosticFact: "Wording must not become continuity identity.",
}));

assert.doesNotThrow(() => GrantRootContinuityIdentityV1Schema.parse({
  checkerId: occurrenceIdentity.checkerId,
  checkerVersion: occurrenceIdentity.checkerVersion,
  category: occurrenceIdentity.category,
  affectedArgumentRoles: ["knowledge_gap", "scientific_question"],
  occurrenceFingerprints: ["a".repeat(64)],
}));

assert.doesNotThrow(() => GrantHierarchicalDiagnosticStageStateSchema.parse({
  stage: "argument_mapping",
  status: "failed",
  sourceRevisionId,
  failureCode: "argument_map_structured_output_invalid",
}));
assert.throws(() => GrantHierarchicalDiagnosticStageStateSchema.parse({
  stage: "argument_mapping",
  status: "failed",
  sourceRevisionId,
  failureCode: null,
}));
assert.throws(() => GrantHierarchicalDiagnosticStageStateSchema.parse({
  stage: "argument_mapping",
  status: "succeeded",
  sourceRevisionId,
  failureCode: "argument_map_provider_failure",
}));

console.log("Grant hierarchical semantic diagnostic target contracts passed.");
