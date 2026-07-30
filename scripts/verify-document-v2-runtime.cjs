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
const {
  normalizeGeneratedComponentPayload,
} = require("../lib/document-v2/generation/normalize-component-payload.ts");

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
      async renderAndStore({ shouldCancel }) {
        assert.equal(await shouldCancel(), false);
        return { artifactId: "artifact-1" };
      },
      async validateArtifact({ shouldCancel }) {
        assert.equal(await shouldCancel(), false);
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
  let completed;
  for (let index = 0; index < 8; index += 1) {
    completed = await service.run(created.job.jobId, `worker-${index + 1}`);
    if (completed.job.status === "completed") break;
  }
  assert.equal(completed.job.status, "completed");
  assert.equal(completed.job.progress, 100);
  assert.equal(completed.job.artifactId, "artifact-1");
  assert.deepEqual(calls, { title: 1, introduction: 1, references: 1 });
  assert.ok(completed.events.some((event) => event.status === "cancelled"));
  assert.ok(
    completed.events.some((event) => event.stage === "quality_check"),
  );
  assert.ok(
    completed.events.some(
      (event) =>
        event.category === "model" &&
        event.operation === "component.started" &&
        event.metadata?.componentType,
    ),
  );
  assert.ok(
    completed.events.some(
      (event) =>
        event.category === "render" &&
        event.operation === "stage.docx_rendering.started",
    ),
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

async function verifyIntakeExistsBeforePlanning() {
  const repository = new InMemoryDocumentJobRepository();
  const service = makeService(repository, {});
  const snapshot = await service.createIntake({
    ownerId: "user-1",
    jobId: requestId,
    instruction: "Generate an SCI review about physical gels.",
    source: { kind: "prompt", sourceIds: [] },
    language: "en",
    textExecution: {
      provider: "deepseek",
      requestedModelId: "deepseek-v4-flash",
      resolvedModelId: "deepseek-v4-flash",
      maxOutputTokens: 3200,
      allowProviderFallback: false,
    },
  });
  assert.equal(snapshot.job.stage, "intake");
  assert.equal(snapshot.job.status, "queued");
  assert.equal(snapshot.job.totalComponents, 0);
  assert.equal("checkpoint" in snapshot.job, false);
  const stored = await repository.get(requestId);
  assert.equal(stored.checkpoint.textExecution.provider, "deepseek");
  assert.equal(stored.checkpoint.orchestration, undefined);
  assert.match(stored.checkpoint.intake.instruction, /physical gels/);
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

async function verifyBoundedTicksResumeFromCheckpoint() {
  const repository = new InMemoryDocumentJobRepository();
  const calls = {};
  const service = makeService(repository, calls);
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });

  const first = await service.run(created.job.jobId, "worker-1", {
    maxComponents: 1,
  });
  assert.equal(first.job.status, "queued");
  assert.equal(first.job.completedComponents, 1);
  assert.equal(first.job.leaseOwner, undefined);

  const second = await service.run(created.job.jobId, "worker-2", {
    maxComponents: 1,
  });
  assert.equal(second.job.status, "queued");
  assert.equal(second.job.completedComponents, 2);

  const third = await service.run(created.job.jobId, "worker-3", {
    maxComponents: 1,
  });
  assert.equal(third.job.status, "queued");
  assert.equal(third.job.completedComponents, 3);

  let completed;
  for (let index = 4; index <= 7; index += 1) {
    completed = await service.run(created.job.jobId, `worker-${index}`, {
      maxComponents: 1,
    });
    if (completed.job.status === "completed") break;
  }
  assert.equal(completed.job.status, "completed");
  assert.deepEqual(calls, { title: 1, introduction: 1, references: 1 });
}

async function verifyTimeBudgetYieldsAfterCheckpoint() {
  const repository = new InMemoryDocumentJobRepository();
  const calls = {};
  const service = makeService(repository, calls);
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  const yielded = await service.run(created.job.jobId, "worker-budget", {
    maxDurationMs: 1,
  });
  assert.equal(yielded.job.status, "queued");
  assert.equal(yielded.job.completedComponents, 1);
  assert.equal(yielded.job.leaseOwner, undefined);
  let completed;
  for (let index = 0; index < 8; index += 1) {
    completed = await service.run(
      created.job.jobId,
      `worker-resume-${index}`,
    );
    if (completed.job.status === "completed") break;
  }
  assert.equal(completed.job.status, "completed");
  assert.deepEqual(calls, { title: 1, introduction: 1, references: 1 });
}

async function verifyDeterministicNormalizationAndPreciseResume() {
  const normalized = normalizeGeneratedComponentPayload({
    kind: "blocks",
    blocks: [
      {
        type: "paragraph",
        role: "abstract",
        text: "```text\nAbstract: Mature abstract content.\n```",
        citationIds: [],
        figureRequestIndexes: [],
      },
      {
        type: "table",
        caption: "Table 2 | Comparison",
        columns: ["Method"],
        rows: [["A"]],
      },
    ],
    figureRequests: [
      {
        slotId: null,
        figureType: "process_flow",
        title: "Process",
        caption: "Fig. 3 | Processing route.",
        altText: "Route",
        contentBrief: "Route",
        placementAfterBlockIndex: 0,
        sourceEvidenceIds: [],
      },
    ],
  });
  assert.equal(normalized.blocks[0].text, "Mature abstract content.");
  assert.equal(normalized.blocks[1].caption, "Comparison");
  assert.equal(normalized.figureRequests[0].caption, "Processing route.");

  const repository = new InMemoryDocumentJobRepository();
  const service = makeService(repository, {});
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  let failed = await repository.get(created.job.jobId);
  const failedOrchestration = structuredClone(failed.checkpoint.orchestration);
  failedOrchestration.status = "failed";
  failedOrchestration.failure = {
    code: "internal_content_leak",
    message: "Internal field entered body text.",
    componentKey: "title",
  };
  failedOrchestration.components[0] = {
    ...failedOrchestration.components[0],
    status: "failed",
    attempts: 2,
    lastError: {
      code: "internal_content_leak",
      message: "Internal field entered body text.",
    },
  };
  failed = await repository.save(
    {
      ...failed,
      status: "failed",
      error: {
        code: "internal_content_leak",
        userMessage: "Content failed validation.",
        technicalMessage: "Internal field entered body text.",
        failedStage: "content_generation",
        componentKey: "title",
      },
      checkpoint: {
        ...failed.checkpoint,
        orchestration: failedOrchestration,
      },
    },
    failed.revision,
  );
  const resumed = await service.resume(failed.jobId);
  const resumedState = await repository.get(failed.jobId);
  assert.equal(resumed.job.status, "queued");
  assert.equal(resumedState.checkpoint.orchestration.components[0].attempts, 0);
  assert.equal(
    resumedState.checkpoint.orchestration.components[0].generationRevision,
    2,
  );
  assert.equal(
    resumedState.checkpoint.orchestration.components[0].lastError.code,
    "internal_content_leak",
  );
}

async function verifyImageCallsAndAssetsUseSeparateBudgets() {
  const repository = new InMemoryDocumentJobRepository();
  const calls = {};
  const planWithFigure = {
    ...plan,
    figureSlots: [
      {
        slotId: "figure-slot-01",
        componentKey: "introduction",
        figureType: "process_flow",
        purpose: "Show the preparation workflow.",
      },
    ],
  };
  let tick = Date.parse("2026-07-28T12:30:00.000Z");
  const service = new DocumentV2JobService(
    repository,
    {
      generator: {
        async generate({ component }) {
          calls[component.componentKey] =
            (calls[component.componentKey] ?? 0) + 1;
          if (component.componentKey !== "introduction") {
            return payload(component.componentKey);
          }
          return {
            kind: "blocks",
            blocks: [
              { type: "heading", level: 1, text: "1 Introduction" },
              {
                type: "paragraph",
                role: "body",
                text: "Physical gels depend on reversible junctions.",
                citationIds: ["ref-1"],
                figureRequestIndexes: [0],
              },
            ],
            figureRequests: [
              {
                slotId: "figure-slot-01",
                figureType: "process_flow",
                title: "Preparation workflow",
                caption: "Preparation routes and reversible junction formation.",
                altText: "A workflow for physical gel preparation.",
                contentBrief: "Show preparation followed by junction formation.",
                placementAfterBlockIndex: 1,
                sourceEvidenceIds: ["ref-1"],
              },
            ],
          };
        },
      },
      validator: { async validate() { return { accepted: true }; } },
      figureAssetMaterializer: {
        async materialize(request, context) {
          context.onProviderCall();
          context.onProviderCall();
          return {
            id: `${request.requestId}-asset`,
            requestId: request.requestId,
            format: "png",
            dataBase64: "cG5n",
            pixelWidth: 1536,
            pixelHeight: 1024,
            dpi: 300,
            displayWidthPx: 491,
            displayHeightPx: 327,
            sha256: "b".repeat(64),
            title: request.title,
            altText: request.altText,
          };
        },
      },
    },
    {
      async renderAndStore() {
        return { artifactId: "artifact-with-figure" };
      },
      async validateArtifact() {},
    },
    () => new Date((tick += 100)),
  );
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan: planWithFigure,
    verifiedReferences: references,
  });
  let stored = await repository.get(created.job.jobId);
  stored = await repository.save(
    {
      ...stored,
      checkpoint: {
        ...stored.checkpoint,
        budget: {
          maxModelCalls: 10,
          maxImageCalls: 4,
          maxImageAssets: 1,
          maxRepairAttempts: 4,
          maxExecutionMs: 600_000,
          usedModelCalls: 0,
          usedImageCalls: 0,
          completedImageAssets: 0,
          usedRepairAttempts: 0,
          usedExecutionMs: 0,
        },
      },
    },
    stored.revision,
  );
  let snapshot;
  for (let index = 0; index < 10; index += 1) {
    snapshot = await service.run(created.job.jobId, `figure-worker-${index}`, {
      maxComponents: 1,
    });
    if (snapshot.job.status === "completed") break;
  }
  assert.equal(snapshot.job.status, "completed");
  const completed = await repository.get(created.job.jobId);
  assert.equal(completed.checkpoint.budget.usedImageCalls, 2);
  assert.equal(completed.checkpoint.budget.completedImageAssets, 1);
  assert.equal(completed.checkpoint.orchestration.figures[0].status, "approved");
}

async function verifyFinalizerFailureIsVisible() {
  const repository = new InMemoryDocumentJobRepository();
  const service = makeService(repository, {}, {
    async renderAndStore() {
      throw new Error("Renderer process exited with code 17.");
    },
    async validateArtifact() {},
  });
  const created = await service.create({
    ownerId: "user-1",
    request,
    plan,
    verifiedReferences: references,
  });
  let failed;
  for (let index = 0; index < 6; index += 1) {
    failed = await service.run(created.job.jobId, `worker-${index + 1}`);
    if (failed.job.status === "failed") break;
  }
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

async function verifyDispatchChecksHttpStatus() {
  const {
    DocumentV2DispatchError,
    dispatchDocumentV2Worker,
  } = require("../lib/document-v2-production/dispatch.ts");
  const previous = {
    CRON_SECRET: process.env.CRON_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const previousFetch = global.fetch;
  process.env.CRON_SECRET = "a".repeat(32);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.OPENAI_API_KEY = "openai";

  try {
    global.fetch = async () =>
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    await assert.rejects(
      () =>
        dispatchDocumentV2Worker({
          cause: "job_created",
          requestUrl: "https://example.com/api/chat",
          jobId: requestId,
        }),
      (error) =>
        error instanceof DocumentV2DispatchError && error.status === 401,
    );

    global.fetch = async () =>
      Response.json({ state: "idle" }, { status: 200 });
    const result = await dispatchDocumentV2Worker({
      cause: "recovery",
      requestUrl: "https://example.com/api/chat",
    });
    assert.deepEqual(result, { state: "idle" });
  } finally {
    global.fetch = previousFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function main() {
  const workerRouteSource = fs.readFileSync(
    path.join(
      projectRoot,
      "app/api/internal/document-v2-worker/route.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    workerRouteSource,
    /dispatchDocumentV2Worker/,
    "The worker must never continue by recursively requesting itself.",
  );
  assert.match(
    workerRouteSource,
    /status:\s*202/,
    "The worker endpoint must acknowledge dispatch before background execution.",
  );
  assert.match(
    workerRouteSource,
    /executeOneDocumentV2Tick\(requestedJobId\)/,
    "A direct wakeup must process the requested job instead of an arbitrary queue item.",
  );
  assert.match(
    workerRouteSource,
    /export const POST = handleWorker/,
    "The worker must support authenticated POST recovery dispatches.",
  );
  for (const sourcePath of [
    "app/api/chat/route.ts",
    "app/api/document-v2/jobs/route.ts",
    "app/api/document-v2/jobs/[id]/route.ts",
    "app/api/internal/document-v2-worker/route.ts",
  ]) {
    const source = fs.readFileSync(path.join(projectRoot, sourcePath), "utf8");
    assert.doesNotMatch(
      source,
      /if\s*\(\s*!secret\s*\)\s*return/,
      `${sourcePath} must not silently skip document worker dispatch.`,
    );
  }
  for (const sourcePath of [
    "app/api/chat/route.ts",
    "app/api/document-v2/jobs/route.ts",
  ]) {
    const source = fs.readFileSync(path.join(projectRoot, sourcePath), "utf8");
    const dispatchIndex = source.indexOf("cause: \"job_created\"");
    assert.ok(dispatchIndex >= 0, `${sourcePath} must dispatch newly created jobs.`);
    const nearbySource = source.slice(Math.max(0, dispatchIndex - 250), dispatchIndex);
    assert.doesNotMatch(
      nearbySource,
      /after\s*\(/,
      `${sourcePath} must await the fast worker acknowledgement in its active request lifecycle.`,
    );
  }
  const targetedDispatchMigration = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/017_document_v2_targeted_dispatch.sql",
    ),
    "utf8",
  );
  assert.match(
    targetedDispatchMigration,
    /claim_document_v2_dispatch/,
    "Direct wakeups require a targeted atomic claim function.",
  );
  assert.match(
    targetedDispatchMigration,
    /WHERE job_id = target_job_id/,
    "Targeted claims must be scoped to the dispatched job.",
  );
  const serverDispatchMigration = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/018_document_v2_server_dispatch.sql",
    ),
    "utf8",
  );
  assert.match(
    serverDispatchMigration,
    /dispatch_document_v2_outbox_event/,
    "Outbox events require an independent server-side dispatcher.",
  );
  assert.match(
    serverDispatchMigration,
    /document-v2-outbox-dispatch/,
    "Pending outbox events require a server-side recovery schedule.",
  );
  const modelExecutionMigration = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/019_document_v2_model_executions.sql",
    ),
    "utf8",
  );
  assert.match(
    modelExecutionMigration,
    /execution_key TEXT PRIMARY KEY/,
    "Model calls require a database-enforced unique execution key.",
  );
  const workerSource = fs.readFileSync(
    path.join(projectRoot, "lib/document-v2-production/worker.ts"),
    "utf8",
  );
  assert.match(
    workerSource,
    /job\.checkpoint\.textExecution/,
    "The worker must read the model provider frozen into the job.",
  );
  assert.doesNotMatch(
    workerSource,
    /new OpenAIStructuredComponentModel\(openai/,
    "Text generation must not bypass the frozen provider executor.",
  );
  const dispatchSource = fs.readFileSync(
    path.join(projectRoot, "lib/document-v2-production/dispatch.ts"),
    "utf8",
  );
  assert.match(
    dispatchSource,
    /if\s*\(\s*!response\.ok\s*\)/,
    "Document worker dispatch must reject non-success HTTP responses.",
  );
  const healthMigrationSource = fs.readFileSync(
    path.join(
      projectRoot,
      "supabase/migrations/016_document_v2_runtime_health.sql",
    ),
    "utf8",
  );
  assert.match(
    healthMigrationSource,
    /document_v2_runtime_health/,
    "The runtime must expose a service-role-only health snapshot.",
  );
  assert.match(
    healthMigrationSource,
    /overdueOutbox/,
    "The runtime health snapshot must report overdue outbox entries.",
  );
  const chatRouteSource = fs.readFileSync(
    path.join(projectRoot, "app/api/chat/route.ts"),
    "utf8",
  );
  assert.match(
    chatRouteSource,
    /const shouldUsePreviousAssistantSource\s*=\s*\n?\s*intentPlan\.inputScope === "previous_assistant_output"/,
    "Conversation source selection must come from the semantic router decision.",
  );
  assert.doesNotMatch(
    chatRouteSource,
    /legacy_previous_assistant_export/,
    "The previous-assistant direct export pipeline must be removed.",
  );
  assert.match(
    chatRouteSource,
    /Word 文档必须由新版文档主链单独生成/,
    "Mixed DOCX requests must not fall back to a legacy exporter.",
  );
  assert.match(
    chatRouteSource,
    /系统不会回退到旧版聊天文本导出/,
    "A disabled V2 runtime must fail explicitly instead of exporting chat text.",
  );
  const intentRouterSource = fs.readFileSync(
    path.join(projectRoot, "lib/chat/intent-router.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    intentRouterSource,
    /const shouldUsePrevious\s*=\s*\n?\s*bundle\.contentSource === "previous_assistant_output"/,
    "A stale context bundle must not override the current user message.",
  );
  const productionWorkerSource = fs.readFileSync(
    path.join(projectRoot, "lib/document-v2-production/worker.ts"),
    "utf8",
  );
  assert.match(
    productionWorkerSource,
    /timeout:\s*75_000/,
    "Model calls must finish before the worker platform timeout.",
  );
  await verifyIntakeExistsBeforePlanning();
  await verifyCancelResumeAndCompletion();
  await verifyLeaseBlocksDuplicateWorker();
  await verifyBoundedTicksResumeFromCheckpoint();
  await verifyTimeBudgetYieldsAfterCheckpoint();
  await verifyDeterministicNormalizationAndPreciseResume();
  await verifyImageCallsAndAssetsUseSeparateBudgets();
  await verifyFinalizerFailureIsVisible();
  await verifyDispatchChecksHttpStatus();
  const previousFlag = process.env.DOCUMENT_V2_RUNTIME_ENABLED;
  delete process.env.DOCUMENT_V2_RUNTIME_ENABLED;
  const route = require("../app/api/document-v2/jobs/[id]/route.ts");
  const disabled = await route.GET(new Request("http://localhost"), {
    params: Promise.resolve({ id: "23b7cee2-bfa7-49d7-b58b-98b734bc5201" }),
  });
  assert.equal(disabled.status, 404);
  const createRoute = require("../app/api/document-v2/jobs/route.ts");
  const disabledCreate = await createRoute.POST(
    new Request("http://localhost/api/document-v2/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: requestId,
        instruction: "Generate an SCI review about physical gels.",
      }),
    }),
  );
  assert.equal(disabledCreate.status, 404);
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
