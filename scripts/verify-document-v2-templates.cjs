const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const swc = require("next/dist/build/swc");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveResearchGptAlias(
  request,
  parent,
  isMain,
  options,
) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(projectRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(
    this,
    resolvedRequest,
    parent,
    isMain,
    options,
  );
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = swc.transformSync(source, {
    filename,
    jsc: {
      parser: { syntax: "typescript" },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const {
  DocumentTemplateRegistry,
  TemplateRegistryError,
} = require("../lib/document-v2/templates/registry.ts");
const {
  TemplateResolutionError,
  compileTemplateSnapshot,
  resolveDocumentTemplate,
} = require("../lib/document-v2/templates/resolver.ts");
const {
  SCI_REVIEW_TEMPLATE,
} = require("../lib/document-v2/templates/sci-review.ts");

const request = {
  requestId: "a26a8864-783b-4a6c-a496-046d3c6c1ccc",
  schemaVersion: 1,
  action: "generate",
  source: { kind: "prompt", sourceIds: [] },
  outputFormat: "docx",
  language: "en",
  templateIntent: "sci_review",
  userRequirements: {
    topic: "Physical gel preparation review",
    targetLength: 3_000,
  },
};

async function verifySystemTemplateResolution() {
  let receivedCandidates;
  const resolution = await resolveDocumentTemplate({
    request,
    matcher: {
      async match({ candidates }) {
        receivedCandidates = candidates;
        return {
          templateId: "sci-review",
          confidence: 0.97,
          rationale:
            "The request asks for an academic review manuscript with citations.",
        };
      },
    },
  });

  assert.equal(receivedCandidates.length, 1);
  assert.equal(receivedCandidates[0].templateId, "sci-review");
  assert.equal(resolution.source, "system_registry");
  assert.equal(resolution.snapshot.templateId, "sci-review");
  assert.equal(resolution.snapshot.renderingProfile, "sci_word_v1");
  assert.match(resolution.snapshot.checksum, /^[a-f0-9]{64}$/);
  assert.equal(resolution.componentBlueprints[0].type, "title");
  assert.equal(
    resolution.componentBlueprints.at(-1).type,
    "reference_list",
  );
  assert.equal(Object.isFrozen(resolution), true);
  assert.equal(Object.isFrozen(resolution.snapshot.typography), true);

  const sameSnapshot = compileTemplateSnapshot(
    SCI_REVIEW_TEMPLATE.snapshotSeed,
  );
  assert.equal(sameSnapshot.checksum, resolution.snapshot.checksum);
  const changedSnapshot = compileTemplateSnapshot({
    ...SCI_REVIEW_TEMPLATE.snapshotSeed,
    typography: {
      ...SCI_REVIEW_TEMPLATE.snapshotSeed.typography,
      bodyStyle: "ChangedBody",
    },
  });
  assert.notEqual(
    changedSnapshot.checksum,
    resolution.snapshot.checksum,
    "Changing a template rule must change its immutable checksum.",
  );
}

async function verifyUnknownAiSelectionIsRejected() {
  await assert.rejects(
    resolveDocumentTemplate({
      request,
      matcher: {
        async match() {
          return {
            templateId: "invented-template",
            confidence: 0.9,
            rationale: "Invented by the matcher.",
          };
        },
      },
    }),
    TemplateResolutionError,
  );
}

async function verifyUserTemplateTakesPrecedence() {
  let matcherCalls = 0;
  let analyzerCalls = 0;
  const resolution = await resolveDocumentTemplate({
    request,
    matcher: {
      async match() {
        matcherCalls += 1;
        throw new Error("Matcher must not run for an uploaded template.");
      },
    },
    userTemplate: {
      uploadId: "upload-42",
      analyzer: {
        async analyze({ uploadId }) {
          analyzerCalls += 1;
          assert.equal(uploadId, "upload-42");
          return {
            analysisVersion: "parser-1",
            displayName: "User SCI Template",
            documentType: "sci_review",
            language: "en",
            typography: {
              ...SCI_REVIEW_TEMPLATE.snapshotSeed.typography,
              titleStyle: "UserDocumentTitle",
            },
            layout: SCI_REVIEW_TEMPLATE.snapshotSeed.layout,
            rules: SCI_REVIEW_TEMPLATE.snapshotSeed.rules,
            componentBlueprints: SCI_REVIEW_TEMPLATE.componentBlueprints,
            warnings: [
              "Unsupported decorative header was intentionally ignored.",
            ],
          };
        },
      },
    },
  });

  assert.equal(matcherCalls, 0);
  assert.equal(analyzerCalls, 1);
  assert.equal(resolution.source, "user_upload");
  assert.deepEqual(resolution.snapshot.origin, {
    kind: "user_upload",
    uploadId: "upload-42",
    analysisVersion: "parser-1",
  });
  assert.equal(resolution.snapshot.typography.titleStyle, "UserDocumentTitle");
  assert.equal(resolution.warnings.length, 1);
  assert.match(resolution.selection.rationale, /takes precedence/);
}

async function verifyUserTemplateLanguageMismatchIsRejected() {
  await assert.rejects(
    resolveDocumentTemplate({
      request,
      matcher: {
        async match() {
          throw new Error("Matcher must not run.");
        },
      },
      userTemplate: {
        uploadId: "upload-zh",
        analyzer: {
          async analyze() {
            return {
              analysisVersion: "parser-1",
              displayName: "Chinese Template",
              documentType: "sci_review",
              language: "zh",
              typography: SCI_REVIEW_TEMPLATE.snapshotSeed.typography,
              layout: SCI_REVIEW_TEMPLATE.snapshotSeed.layout,
              rules: SCI_REVIEW_TEMPLATE.snapshotSeed.rules,
              componentBlueprints: SCI_REVIEW_TEMPLATE.componentBlueprints,
              warnings: [],
            };
          },
        },
      },
    }),
    TemplateResolutionError,
  );
}

function verifyRegistryBoundaries() {
  assert.throws(
    () =>
      new DocumentTemplateRegistry([
        SCI_REVIEW_TEMPLATE,
        structuredClone(SCI_REVIEW_TEMPLATE),
      ]),
    TemplateRegistryError,
  );

  const planned = structuredClone(SCI_REVIEW_TEMPLATE);
  planned.templateId = "planned-template";
  planned.snapshotSeed.templateId = "planned-template";
  planned.status = "planned";
  const registry = new DocumentTemplateRegistry([planned]);
  assert.equal(
    registry.activeCandidates({
      language: "en",
      outputFormat: "docx",
      documentType: "sci_review",
    }).length,
    0,
    "Planned templates must not be offered to the matcher.",
  );
}

async function main() {
  await verifySystemTemplateResolution();
  await verifyUnknownAiSelectionIsRejected();
  await verifyUserTemplateTakesPrecedence();
  await verifyUserTemplateLanguageMismatchIsRejected();
  verifyRegistryBoundaries();
  console.log("Document v2 template tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
