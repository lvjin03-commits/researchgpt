/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const swc = require("next/dist/build/swc");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  const resolved = request.startsWith("@/")
    ? path.join(projectRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolved, parent, isMain, options);
};
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const output = swc.transformSync(fs.readFileSync(filename, "utf8"), {
    filename,
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const { z } = require("zod");
const {
  parseStructuredResponse,
} = require("../lib/document-v2-production/structured-response-parser.ts");
const {
  DocumentFigureIntentsDraftSchema,
  DocumentSectionIndexDraftSchema,
  normalizeFigureIntentCandidate,
  normalizeSectionIndexCandidate,
} = require("../lib/document-v2/planning/contracts.ts");

const schema = z.object({ ready: z.boolean(), topic: z.string() }).strict();
const parse = (content) => parseStructuredResponse({ content, schema });

const direct = parse('{"ready":true,"topic":"LLM"}');
assert.equal(direct.ok, true);
assert.deepEqual(direct.repairSteps, []);

const fenced = parse('```json\n{"ready":true,"topic":"LLM"}\n```');
assert.equal(fenced.ok, true);
assert.ok(fenced.repairSteps.includes("markdown_fence_removed"));

const prose = parse('Result follows:\n{"ready":true,"topic":"LLM"}\nDone.');
assert.equal(prose.ok, true);
assert.ok(prose.repairSteps.includes("surrounding_text_removed"));

const exampleThenFinal = parse(
  'Example: {"ready":false}\nFinal: {"ready":true,"topic":"LLM"}',
);
assert.equal(exampleThenFinal.ok, true);
assert.equal(exampleThenFinal.value.topic, "LLM");
assert.equal(exampleThenFinal.candidateDiagnostics.length, 2);

const unmatchedProseBrace = parse(
  'Format starts with { but final answer is {"ready":true,"topic":"LLM"}',
);
assert.equal(unmatchedProseBrace.ok, true);
assert.equal(unmatchedProseBrace.value.topic, "LLM");

const ambiguous = parse(
  '{"ready":true,"topic":"one"}\n{"ready":true,"topic":"two"}',
);
assert.equal(ambiguous.ok, false);
assert.equal(ambiguous.failureCategory, "ambiguous_json");

const trailingComma = parse('{"ready":true,"topic":"LLM",}');
assert.equal(trailingComma.ok, true);
assert.ok(trailingComma.repairSteps.includes("trailing_comma_removed"));

const bracesInString = parse(
  '{"ready":true,"topic":"literal { value } and ,}"}',
);
assert.equal(bracesInString.ok, true);
assert.equal(bracesInString.value.topic, "literal { value } and ,}");

const truncated = parse('{"ready":true,"topic":"LLM"');
assert.equal(truncated.ok, false);
assert.equal(truncated.failureCategory, "truncated_json");

const sectionIndexWithProgramFields = parseStructuredResponse({
  content: JSON.stringify({
    schemaVersion: 99,
    sections: [
      {
        sectionId: "model-owned-id",
        order: 7,
        heading: "Introduction",
        question: "What is the scope?",
        purpose: "Define the scope.",
        owns: ["scope"],
        excludes: ["applications"],
        relativeWeight: "0.2",
      },
    ],
  }),
  schema: DocumentSectionIndexDraftSchema,
  normalizeCandidate: normalizeSectionIndexCandidate,
});
assert.equal(sectionIndexWithProgramFields.ok, true);
assert.equal(sectionIndexWithProgramFields.value.sections[0].relativeWeight, 0.2);
assert.equal(
  Object.hasOwn(sectionIndexWithProgramFields.parsedResponse, "schemaVersion"),
  false,
);
assert.equal(
  Object.hasOwn(
    sectionIndexWithProgramFields.parsedResponse.sections[0],
    "sectionId",
  ),
  false,
);
assert.deepEqual(sectionIndexWithProgramFields.repairSteps, [
  "program_owned_fields_removed",
  "deterministic_type_coerced",
]);

const sectionIndexMissingSemanticField = parseStructuredResponse({
  content: JSON.stringify({
    sections: [
      {
        heading: "Introduction",
        question: "What is the scope?",
        owns: [],
        excludes: [],
        relativeWeight: 0.2,
      },
    ],
  }),
  schema: DocumentSectionIndexDraftSchema,
  normalizeCandidate: normalizeSectionIndexCandidate,
});
assert.equal(sectionIndexMissingSemanticField.ok, false);
assert.equal(
  sectionIndexMissingSemanticField.failureCategory,
  "schema_validation_failed",
);
assert.deepEqual(
  sectionIndexMissingSemanticField.candidateDiagnostics[0].schemaIssuePaths,
  ["sections.0.purpose"],
);

const missingField = parse('{"ready":true}');
assert.equal(missingField.ok, false);
assert.equal(missingField.failureCategory, "schema_validation_failed");
assert.deepEqual(
  missingField.candidateDiagnostics[0].schemaIssuePaths,
  ["topic"],
);

const invariantFailure = parseStructuredResponse({
  content: '{"ready":true,"topic":"forbidden"}',
  schema,
  validateCandidate: (candidate) => {
    if (candidate.topic === "forbidden") {
      throw new Error("The semantic invariant rejected this candidate.");
    }
  },
});
assert.equal(invariantFailure.ok, false);
assert.equal(invariantFailure.failureCategory, "schema_validation_failed");
assert.deepEqual(
  invariantFailure.candidateDiagnostics[0].schemaIssuePaths,
  ["$invariant"],
);

const proseOnly = parse("This response contains no structured object.");
assert.equal(proseOnly.ok, false);
assert.equal(proseOnly.failureCategory, "no_json_object");

const syntaxError = parse('{"ready":true,"topic":invalid}');
assert.equal(syntaxError.ok, false);
assert.equal(syntaxError.failureCategory, "json_syntax_error");
assert.ok(syntaxError.candidateDiagnostics[0].parseErrorMessage);

const figurePayload = {
  figures: [
    {
      sectionOrder: 1,
      figureType: "conceptual_framework",
      purpose: "Explain the conceptual relationship.",
      questionAnswered: "How are the mechanisms related?",
      claimsRepresented: ["The mechanisms form a coherent framework."],
      evidenceRequired: false,
      requiredEvidenceIds: ["evidence-1"],
      citationIds: ["evidence-1"],
    },
  ],
};
const normalizedFigure = parseStructuredResponse({
  content: JSON.stringify(figurePayload),
  schema: DocumentFigureIntentsDraftSchema,
  normalizeCandidate: normalizeFigureIntentCandidate,
});
assert.equal(normalizedFigure.ok, true);
assert.deepEqual(normalizedFigure.repairSteps, [
  "out_of_scope_fields_removed",
]);
assert.deepEqual(
  normalizedFigure.candidateDiagnostics[0].normalizationPaths,
  ["figures[0].requiredEvidenceIds", "figures[0].citationIds"],
);
assert.equal(
  Object.hasOwn(normalizedFigure.parsedResponse.figures[0], "requiredEvidenceIds"),
  false,
);
const normalizedOnce = normalizeFigureIntentCandidate(figurePayload);
const normalizedTwice = normalizeFigureIntentCandidate(normalizedOnce.value);
assert.deepEqual(normalizedTwice.value, normalizedOnce.value);
assert.deepEqual(normalizedTwice.normalizationPaths, []);

const unknownFigureField = parseStructuredResponse({
  content: JSON.stringify({
    figures: [
      {
        ...figurePayload.figures[0],
        sourceUrl: "https://example.invalid/source",
      },
    ],
  }),
  schema: DocumentFigureIntentsDraftSchema,
  normalizeCandidate: normalizeFigureIntentCandidate,
});
assert.equal(unknownFigureField.ok, false);
assert.equal(unknownFigureField.failureCategory, "schema_validation_failed");
assert.deepEqual(
  unknownFigureField.candidateDiagnostics[0].schemaIssuePaths,
  ["figures.0"],
);

const contradictoryDataPlot = parseStructuredResponse({
  content: JSON.stringify({
    figures: [
      {
        ...figurePayload.figures[0],
        figureType: "data_plot",
        evidenceRequired: false,
      },
    ],
  }),
  schema: DocumentFigureIntentsDraftSchema,
  normalizeCandidate: normalizeFigureIntentCandidate,
});
assert.equal(contradictoryDataPlot.ok, false);
assert.equal(contradictoryDataPlot.failureCategory, "schema_validation_failed");

console.log("Document v2 structured response parser tests passed.");
