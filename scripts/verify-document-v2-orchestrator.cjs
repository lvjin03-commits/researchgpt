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
  DocumentPlanInvariantError,
  createDocumentOrchestrationState,
  runDocumentOrchestration,
} = require("../lib/document-v2/orchestration/orchestrator.ts");

const requestId = "23b7cee2-bfa7-49d7-b58b-98b734bc5201";
const jobId = "d9dc43c6-a785-4e85-a930-96572931802b";
const templateSnapshot = {
  templateId: "sci-review",
  templateVersion: "1",
  checksum: "a".repeat(64),
  origin: { kind: "system" },
  renderingProfile: "sci_word_v1",
  contentProfile: "sci_review_v1",
  typography: {
    titleStyle: "DocumentTitle",
    heading1Style: "Heading1",
    heading2Style: "Heading2",
    heading3Style: "Heading3",
    bodyStyle: "Body",
    captionStyle: "Caption",
    referenceStyle: "Reference",
  },
  layout: {
    pageSize: "A4",
    orientation: "portrait",
    columns: 1,
  },
  rules: {
    headingDepth: 3,
    figureCaptionPosition: "below",
    tableCaptionPosition: "above",
  },
};

const request = {
  requestId,
  schemaVersion: 1,
  action: "generate",
  source: { kind: "prompt", sourceIds: [] },
  outputFormat: "docx",
  language: "en",
  templateIntent: "sci_review",
  userRequirements: {
    topic: "Physical gel preparation",
    targetLength: 2_000,
  },
};

const plan = {
  requestId,
  schemaVersion: 1,
  templateSnapshot,
  components: [
    {
      componentKey: "title",
      type: "title",
      purpose: "Write the final title.",
    },
    {
      componentKey: "abstract",
      type: "abstract",
      purpose: "Write the final abstract.",
    },
    {
      componentKey: "keywords",
      type: "keywords",
      purpose: "Write final keywords.",
    },
    {
      componentKey: "introduction",
      type: "section",
      heading: "1 Introduction",
      purpose: "Write the introduction.",
    },
    {
      componentKey: "conclusion",
      type: "conclusion",
      heading: "2 Conclusion",
      purpose: "Write the conclusion.",
    },
    {
      componentKey: "references",
      type: "reference_list",
      purpose: "Select verified references used in the document.",
    },
  ],
  evidenceRequirements: [],
};

const verifiedReferences = [
  {
    id: "ref-1",
    title: "Verified source",
    authors: ["A. Researcher"],
    year: 2025,
    venue: "Materials Review",
    verifiedBy: "user_material",
    sourceId: "attachment-1",
  },
];

function payloadFor(componentKey) {
  switch (componentKey) {
    case "title":
      return {
        kind: "title",
        title: "Physical Gel Preparation and Structural Control",
      };
    case "abstract":
      return {
        kind: "blocks",
        blocks: [
          {
            type: "paragraph",
            role: "abstract",
            text: "This review examines physical gel preparation.",
            citationIds: ["ref-1"],
          },
        ],
      };
    case "keywords":
      return {
        kind: "blocks",
        blocks: [
          {
            type: "keywords",
            values: ["physical gels", "preparation", "structure"],
          },
        ],
      };
    case "introduction":
      return {
        kind: "blocks",
        blocks: [
          { type: "heading", level: 1, text: "1 Introduction" },
          {
            type: "paragraph",
            role: "body",
            text: "Physical networks depend on reversible interactions.",
            citationIds: ["ref-1"],
          },
        ],
      };
    case "conclusion":
      return {
        kind: "blocks",
        blocks: [
          { type: "heading", level: 1, text: "2 Conclusion" },
          {
            type: "paragraph",
            role: "conclusion",
            text: "Future studies should connect processing to performance.",
            citationIds: [],
          },
        ],
      };
    case "references":
      return { kind: "references", referenceIds: ["ref-1"] };
    default:
      throw new Error(`Unexpected component ${componentKey}`);
  }
}

function makeGenerator(callCounts) {
  return {
    async generate(context) {
      callCounts[context.component.componentKey] =
        (callCounts[context.component.componentKey] ?? 0) + 1;
      return payloadFor(context.component.componentKey);
    },
  };
}

async function verifyLocalRetry() {
  const callCounts = {};
  const validationAttempts = {};
  const state = createDocumentOrchestrationState({
    jobId,
    request,
    plan,
    verifiedReferences,
  });
  const completed = await runDocumentOrchestration(state, {
    generator: makeGenerator(callCounts),
    validator: {
      async validate({ component }) {
        validationAttempts[component.componentKey] =
          (validationAttempts[component.componentKey] ?? 0) + 1;
        if (
          component.componentKey === "abstract" &&
          validationAttempts.abstract === 1
        ) {
          return {
            accepted: false,
            code: "abstract_scope_missing",
            feedback: "State the review scope explicitly.",
          };
        }
        return { accepted: true };
      },
    },
    maxAttemptsPerComponent: 2,
  });

  assert.equal(completed.status, "completed");
  assert.equal(callCounts.title, 1, "Approved title must not be regenerated.");
  assert.equal(callCounts.abstract, 2, "Only the rejected abstract should retry.");
  assert.equal(callCounts.keywords, 1);
  assert.equal(completed.components[1].attempts, 2);
  assert.equal(completed.finalSpec.metadata.title, payloadFor("title").title);
  assert.deepEqual(
    completed.finalSpec.blocks.map((block) => block.id),
    [
      "abstract-1",
      "keywords-1",
      "introduction-1",
      "introduction-2",
      "conclusion-1",
      "conclusion-2",
    ],
    "Program-owned block IDs must be stable and follow plan order.",
  );
  assert.deepEqual(
    completed.finalSpec.references.map((reference) => reference.id),
    ["ref-1"],
  );
  assert.equal(
    completed.events.filter((event) => event.type === "component_rejected")
      .length,
    1,
  );
}

async function verifyPauseAndResume() {
  const callCounts = {};
  const initial = createDocumentOrchestrationState({
    jobId: "e957c17a-5fe5-493f-827c-a2f547ddac72",
    request,
    plan,
    verifiedReferences,
  });
  const paused = await runDocumentOrchestration(initial, {
    generator: makeGenerator(callCounts),
    validator: { async validate() { return { accepted: true }; } },
    maxComponentsPerRun: 2,
  });
  assert.equal(paused.status, "paused");
  assert.equal(paused.currentComponentIndex, 2);
  assert.equal(callCounts.title, 1);
  assert.equal(callCounts.abstract, 1);
  assert.equal(callCounts.keywords, undefined);

  const restored = JSON.parse(JSON.stringify(paused));
  const completed = await runDocumentOrchestration(restored, {
    generator: makeGenerator(callCounts),
    validator: { async validate() { return { accepted: true }; } },
  });
  assert.equal(completed.status, "completed");
  assert.equal(callCounts.title, 1, "Resume must preserve the approved title.");
  assert.equal(
    callCounts.abstract,
    1,
    "Resume must preserve the approved abstract.",
  );
  assert.equal(callCounts.keywords, 1);
  assert.equal(
    completed.events.filter((event) => event.type === "job_started").length,
    1,
    "Resume must continue the same job instead of starting a second job.",
  );
}

async function verifyRetryLimitStopsJob() {
  const callCounts = {};
  const initial = createDocumentOrchestrationState({
    jobId: "0377c34c-2652-41c9-bc0d-007046a9cb55",
    request,
    plan,
    verifiedReferences,
  });
  const failed = await runDocumentOrchestration(initial, {
    generator: makeGenerator(callCounts),
    validator: {
      async validate({ component }) {
        if (component.componentKey === "abstract") {
          return {
            accepted: false,
            code: "abstract_invalid",
            feedback: "Abstract is still invalid.",
          };
        }
        return { accepted: true };
      },
    },
    maxAttemptsPerComponent: 2,
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failure.componentKey, "abstract");
  assert.equal(callCounts.title, 1);
  assert.equal(callCounts.abstract, 2);
  assert.equal(
    callCounts.keywords,
    undefined,
    "Later components must not run after a terminal failure.",
  );
  assert.equal(failed.finalSpec, undefined);
}

async function verifyStructuralFailureIsLocal() {
  const callCounts = {};
  let repairCode;
  const initial = createDocumentOrchestrationState({
    jobId: "a80f54a6-b397-4114-9ec9-111f4b4a4f2a",
    request,
    plan,
    verifiedReferences,
  });
  const completed = await runDocumentOrchestration(initial, {
    generator: {
      async generate(context) {
        callCounts[context.component.componentKey] =
          (callCounts[context.component.componentKey] ?? 0) + 1;
        if (context.component.componentKey === "abstract") {
          repairCode = context.repairFeedback?.code ?? repairCode;
          const payload = payloadFor("abstract");
          if (context.attempt === 1) {
            payload.blocks[0].citationIds = ["unverified-reference"];
          }
          return payload;
        }
        return payloadFor(context.component.componentKey);
      },
    },
    validator: { async validate() { return { accepted: true }; } },
    maxAttemptsPerComponent: 2,
  });

  assert.equal(completed.status, "completed");
  assert.equal(callCounts.title, 1);
  assert.equal(callCounts.abstract, 2);
  assert.equal(repairCode, "component_structure_invalid");
  assert.equal(
    completed.events.find(
      (event) =>
        event.type === "component_rejected" &&
        event.componentKey === "abstract",
    ).code,
    "component_structure_invalid",
  );
}

function verifyPlanInvariants() {
  assert.throws(
    () =>
      createDocumentOrchestrationState({
        jobId: "282f4f88-c43d-44f3-92f9-9e5fc7b15d6d",
        request,
        plan: {
          ...plan,
          components: [plan.components[1], ...plan.components.slice(2)],
        },
        verifiedReferences,
      }),
    DocumentPlanInvariantError,
  );
}

async function main() {
  await verifyLocalRetry();
  await verifyPauseAndResume();
  await verifyRetryLimitStopsJob();
  await verifyStructuralFailureIsLocal();
  verifyPlanInvariants();
  console.log("Document v2 orchestrator tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
