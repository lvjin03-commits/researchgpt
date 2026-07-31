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

const missingField = parse('{"ready":true}');
assert.equal(missingField.ok, false);
assert.equal(missingField.failureCategory, "schema_validation_failed");
assert.deepEqual(
  missingField.candidateDiagnostics[0].schemaIssuePaths,
  ["topic"],
);

const proseOnly = parse("This response contains no structured object.");
assert.equal(proseOnly.ok, false);
assert.equal(proseOnly.failureCategory, "no_json_object");

const syntaxError = parse('{"ready":true,"topic":invalid}');
assert.equal(syntaxError.ok, false);
assert.equal(syntaxError.failureCategory, "json_syntax_error");
assert.ok(syntaxError.candidateDiagnostics[0].parseErrorMessage);

console.log("Document v2 structured response parser tests passed.");
