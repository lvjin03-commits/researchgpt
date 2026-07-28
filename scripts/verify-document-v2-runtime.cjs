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
function compileTypeScript(module, filename) {
  const output = swc.transformSync(fs.readFileSync(filename, "utf8"), {
    filename,
    jsc: {
      parser: {
        syntax: "typescript",
        tsx: filename.endsWith(".tsx"),
      },
      transform: { react: { runtime: "automatic" } },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
}
require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;

const {
  DocumentV2JobService,
  DocumentJobLeaseUnavailableError,
} = require("../lib/document-v2/runtime/job-service.ts");
const {
  InMemoryDocumentJobRepository,
} = require("../lib/document-v2/runtime/repository.ts");

const requestId = "23b7cee2-bfa7-49d7-b58b-98b734bc5201";
const request = {
  requestId,
  schemaVersion: 1,
  action: "generate",
  source: { kind: "prompt", sourceIds: [] },
  outputFormat: "docx",
  language: "en",
  templateIntent: "sci_review",
  userRequirements: { topic: "Physical gel preparation" },
};
const plan = {
  requestId,
  schemaVersion: 1,
  templateSnapshot: {
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
    layout: { pageSize: "A4", orientation: "portrait", columns: 1 },
    rules: {
      headingDepth: 3,
      figureCaptionPosition: "below",
      tableCaptionPosition: "above",
    },
  },
  components: [
    { componentKey: "title", type: "title", purpose: "生成标题" },
    {
      componentKey: "introduction",
      type: "section",
      heading: "1 Introduction",
      purpose: "生成引言",
    },
    {
      componentKey: "references",
      type: "reference_list",
      purpose: "整理参考文献",
    },
  ],
  evidenceRequirements: [],
};
const references = [
  {
    id: "ref-1",
    title: "Verified physical gel source",
    authors: ["A. Researcher"],
    year: 2025,
    venue: "Materials Review",
    verifiedBy: "user_material",
    sourceId: "attachment-1",
  },
];

function payload(componentKey) {
  if (componentKey === "title") {
    return { kind: "title", title: "Physical Gel Preparation" };
  }
  if (componentKey === "introduction") {
    return {
      kind: "blocks",
      blocks: [
        { type: "heading", level: 1, text: "1 Introduction" },
        {
          type: "paragraph",
          role: "body",
          text: "Physical gels depend on reversible junctions.",
          citationIds: ["ref-1"],
          figureRequestIndexes: [],
        },
      ],
      figureRequests: [],
    };
  }
  return { kind: "references", referenceIds: ["ref-1"] };
}

function makeService(repository, calls, finalizerOverride) {
  let tick = Date.parse("2026-07-28T12:00:00.000Z");
  return new DocumentV2JobService(
    repository,
    {
      generator: {
        async generate({ component }) {
          calls[component.componentKey] =
            (calls[component.componentKey] ?? 0) + 1;
          return payload(component.componentKey);
        },
      },
      validator: { async validate() { return { accepted: true }; } },
    },
    finalizerOverride ?? {
      async renderAndStore({ onStage, shouldCancel }) {
        for (const stage of [
          "docx_rendering",
          "quality_check",
          "artifact_storage",
        ]) {
          assert.equal(await shouldCancel(), false);
          await onStage(stage);
        }
        return { artifactId: "artifact-1" };
      },
    },
    () => new Date((tick += 100)),
  );
}

async function verifyCancelResumeAndCompletion() {
  const repository = new InMemoryDocumentJobRepository();
  const calls = {};
  const service = makeService(repository, calls);
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  assert.equal(created.job.status, "queued");
  assert.equal("checkpoint" in created.job, false);

  await service.requestCancel(created.job.jobId);
  const cancelled = await service.run(created.job.jobId, "worker-1");
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.resumable, true);

  await service.resume(created.job.jobId);
  const completed = await service.run(created.job.jobId, "worker-1");
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.progress, 100);
  assert.equal(completed.job.artifactId, "artifact-1");
  assert.deepEqual(calls, { title: 1, introduction: 1, references: 1 });
  assert.ok(completed.events.some((event) => event.status === "cancelled"));
  assert.ok(
    completed.events.some((event) => event.stage === "quality_check"),
  );
  completed.events.forEach((event, index) => {
    assert.equal(event.sequence, index + 1);
  });
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const {
    DocumentV2JobProgress,
  } = require("../components/document-v2-job-progress.tsx");
  const markup = renderToStaticMarkup(
    React.createElement(DocumentV2JobProgress, { snapshot: completed }),
  );
  assert.match(markup, /文件已生成/);
  assert.match(markup, /100%/);
  assert.match(markup, /已完成 3\/3 个文档部分/);
}

async function verifyLeaseBlocksDuplicateWorker() {
  const repository = new InMemoryDocumentJobRepository();
  const service = makeService(repository, {});
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  await repository.acquireLease({
    jobId: created.job.jobId,
    workerId: "worker-a",
    now: new Date("2026-07-28T12:00:01.000Z"),
    leaseMs: 60_000,
  });
  await assert.rejects(
    service.run(created.job.jobId, "worker-b"),
    DocumentJobLeaseUnavailableError,
  );
}

async function verifyFinalizerFailureIsVisible() {
  const repository = new InMemoryDocumentJobRepository();
  const service = makeService(repository, {}, {
    async renderAndStore({ onStage }) {
      await onStage("docx_rendering");
      throw new Error("Renderer process exited with code 17.");
    },
  });
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  const failed = await service.run(created.job.jobId, "worker-1");
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.job.error.failedStage, "docx_rendering");
  assert.equal(failed.job.error.code, "document_finalization_failed");
  assert.match(failed.job.error.userMessage, /排版失败/);
  assert.ok(
    failed.events.some(
      (event) =>
        event.status === "failed" &&
        event.technicalMessage.includes("code 17"),
    ),
  );
}

async function main() {
  await verifyCancelResumeAndCompletion();
  await verifyLeaseBlocksDuplicateWorker();
  await verifyFinalizerFailureIsVisible();
  const previousFlag = process.env.DOCUMENT_V2_RUNTIME_ENABLED;
  delete process.env.DOCUMENT_V2_RUNTIME_ENABLED;
  const route = require("../app/api/document-v2/jobs/[id]/route.ts");
  const disabled = await route.GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "23b7cee2-bfa7-49d7-b58b-98b734bc5201" }),
  });
  assert.equal(disabled.status, 404);
  if (previousFlag === undefined) {
    delete process.env.DOCUMENT_V2_RUNTIME_ENABLED;
  } else {
    process.env.DOCUMENT_V2_RUNTIME_ENABLED = previousFlag;
  }
  console.log("Document v2 runtime lifecycle tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
