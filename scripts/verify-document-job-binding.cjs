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

const {
  bindDocumentJobMarker,
  extractDocumentJobId,
} = require("../lib/chat/document-job-binding.ts");
const {
  normalizeDisplayMessage,
} = require("../lib/chat/message-normalize.ts");

const oldJobId = "11111111-1111-4111-8111-111111111111";
const newJobId = "22222222-2222-4222-8222-222222222222";
const rebound = bindDocumentJobMarker(
  `Document created.\n\n[[RESEARCHGPT_DOCUMENT_JOB:${oldJobId}]]`,
  newJobId,
);

assert.equal(extractDocumentJobId(rebound), newJobId);
assert.equal(rebound.includes(oldJobId), false);
assert.equal(
  (rebound.match(/RESEARCHGPT_DOCUMENT_JOB/g) ?? []).length,
  1,
);

const normalized = normalizeDisplayMessage({
  role: "assistant",
  content: rebound,
});
assert.equal(normalized.documentJobId, newJobId);
assert.equal(normalized.documentJobBindingVersion, 1);

const explicitBinding = normalizeDisplayMessage({
  role: "assistant",
  content: rebound,
  documentJobId: oldJobId,
  documentJobBindingVersion: 7,
});
assert.equal(explicitBinding.documentJobId, oldJobId);
assert.equal(explicitBinding.documentJobBindingVersion, 7);

console.log("Document job binding tests passed.");
