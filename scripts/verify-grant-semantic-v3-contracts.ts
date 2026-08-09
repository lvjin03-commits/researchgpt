import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES,
  GrantSemanticDiagnosticCategoryV3Schema,
  GrantSemanticDiagnosticProviderResultV3Schema,
  GrantSemanticDiagnosticResultV3Schema,
  GrantSemanticDiagnosticV3ReferenceError,
  assertGrantSemanticDiagnosticV3References,
} from "../lib/grants/diagnostics/semantic-v3-contracts.ts";

const sectionId = randomUUID();
const nodeId = randomUUID();
const relatedSectionId = randomUUID();
const relatedNodeId = randomUUID();
const evidenceCardId = randomUUID();

const validResult = {
  findings: [{
    category: "cross_section_inconsistency" as const,
    title: "研究范围在章节间发生变化",
    diagnosticFact: "科学问题限定为锌体系，但预期成果扩展到了碱金属体系。",
    reason: "前后研究对象不一致，读者无法确认最终结论的适用边界。",
    recommendation: "统一研究对象，或补充碱金属体系对应的研究内容和验证路线。",
    possibleConsequence: null,
    assessment: { scope: "cross_section" as const, confidence: 0.94, actionability: "directly_actionable" as const },
    primaryLocation: { sectionId, nodeId },
    relatedLocations: [{
      sectionId: relatedSectionId,
      nodeId: relatedNodeId,
      role: "downstream_dependency" as const,
      quote: "预期形成适用于多种碱金属体系的规律。",
    }],
    usedEvidenceCardIds: [evidenceCardId],
  }],
};

const responseFormat = zodResponseFormat(GrantSemanticDiagnosticProviderResultV3Schema, "grant_semantic_diagnostic_v3");
assert.equal(responseFormat.type, "json_schema");
assert.equal(responseFormat.json_schema.strict, true);
const jsonSchema = responseFormat.json_schema.schema as Record<string, unknown>;

const forbiddenProviderKeywords = new Set([
  "default",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

function assertStrictProviderSchema(value: unknown, path = "$schema"): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const keyword of forbiddenProviderKeywords) {
    assert.equal(keyword in record, false, `${path} must not use provider-unsupported keyword ${keyword}`);
  }
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false, `${path} must reject additional properties`);
    const propertyNames = Object.keys((record.properties ?? {}) as Record<string, unknown>);
    assert.deepEqual(record.required, propertyNames, `${path} must require every property`);
  }
  for (const [key, child] of Object.entries(record)) assertStrictProviderSchema(child, `${path}.${key}`);
}

assertStrictProviderSchema(jsonSchema);
assert.deepEqual(GrantSemanticDiagnosticProviderResultV3Schema.parse(validResult), validResult);
assert.deepEqual(GrantSemanticDiagnosticResultV3Schema.parse(validResult), validResult);

const nullAndEmptyArrays = structuredClone(validResult);
nullAndEmptyArrays.findings[0]!.possibleConsequence = null;
nullAndEmptyArrays.findings[0]!.relatedLocations = [];
nullAndEmptyArrays.findings[0]!.usedEvidenceCardIds = [];
assert.doesNotThrow(() => GrantSemanticDiagnosticResultV3Schema.parse(nullAndEmptyArrays));

const missingNullableField = structuredClone(validResult) as Record<string, unknown>;
delete ((missingNullableField.findings as Array<Record<string, unknown>>)[0]!).possibleConsequence;
assert.throws(() => GrantSemanticDiagnosticProviderResultV3Schema.parse(missingNullableField));

const invalidUuid = structuredClone(validResult) as unknown as {
  findings: Array<{ primaryLocation: { nodeId: string } }>;
};
invalidUuid.findings[0]!.primaryLocation.nodeId = "not-a-uuid";
assert.doesNotThrow(() => GrantSemanticDiagnosticProviderResultV3Schema.parse(invalidUuid));
assert.throws(() => GrantSemanticDiagnosticResultV3Schema.parse(invalidUuid));

const invalidConfidence = structuredClone(validResult);
invalidConfidence.findings[0]!.assessment.confidence = 1.5;
assert.doesNotThrow(() => GrantSemanticDiagnosticProviderResultV3Schema.parse(invalidConfidence));
assert.throws(() => GrantSemanticDiagnosticResultV3Schema.parse(invalidConfidence));

const parsed = GrantSemanticDiagnosticResultV3Schema.parse(validResult);
assert.doesNotThrow(() => assertGrantSemanticDiagnosticV3References(parsed, {
  sectionIdByNodeId: new Map([[nodeId, sectionId], [relatedNodeId, relatedSectionId]]),
  allowedEvidenceCardIds: new Set([evidenceCardId]),
}));

assert.throws(
  () => assertGrantSemanticDiagnosticV3References(parsed, {
    sectionIdByNodeId: new Map([[nodeId, sectionId], [relatedNodeId, relatedSectionId]]),
    allowedEvidenceCardIds: new Set(),
  }),
  (error: unknown) => error instanceof GrantSemanticDiagnosticV3ReferenceError
    && error.invalidPaths.includes("findings.0.usedEvidenceCardIds.0"),
);

assert.throws(
  () => assertGrantSemanticDiagnosticV3References(parsed, {
    sectionIdByNodeId: new Map([[nodeId, sectionId]]),
    allowedEvidenceCardIds: new Set([evidenceCardId]),
  }),
  (error: unknown) => error instanceof GrantSemanticDiagnosticV3ReferenceError
    && error.invalidPaths.includes("findings.0.relatedLocations.0"),
);

const categoryNames = GrantSemanticDiagnosticCategoryV3Schema.options;
assert.deepEqual(Object.keys(GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES), categoryNames);
for (const category of categoryNames) {
  const boundary = GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES[category];
  assert.ok(boundary.definition.length > 20, `${category} needs a concrete definition`);
  assert.ok(boundary.positiveExamples.length >= 1, `${category} needs a positive example`);
  assert.ok(boundary.negativeExamples.length >= 1, `${category} needs a negative example`);
}
assert.match(GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES.scientific_question_gap.negativeExamples[0]!, /argument_chain_gap|objective_content_route_gap/);
assert.match(GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES.argument_chain_gap.negativeExamples[0]!, /scientific_question_gap/);
assert.match(GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES.feasibility_support_gap.negativeExamples[0]!, /evidence_support_gap/);
assert.match(GRANT_SEMANTIC_V3_CATEGORY_BOUNDARIES.evidence_support_gap.negativeExamples[0]!, /feasibility_support_gap/);

console.log("Grant semantic diagnostic V3 schema and boundary contracts passed.");
