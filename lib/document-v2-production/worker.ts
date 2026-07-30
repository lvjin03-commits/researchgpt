import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import JSZip from "jszip";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DocumentJobSchema, type DocumentJob } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { ModelDocumentComponentGenerator } from "@/lib/document-v2/generation/model-component-generator";
import { MatureDocumentComponentValidator } from "@/lib/document-v2/generation/mature-content-validator";
import { ValidatedFigureAssetPipeline } from "@/lib/document-v2/assets/figure-pipeline";
import { renderFinalDocumentSpecToDocx } from "@/lib/document-v2/renderers/docx";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import type { ExportRecord } from "@/lib/export/types";
import {
  OpenAIFinalFigureGenerator,
  OpenAIStructuredComponentModel,
} from "./openai-adapters";
import {
  ProviderDocumentTextExecutor,
  type DocumentModelUsage,
  type DocumentStructuredTextExecutor,
} from "./text-executor";
import { requireDocumentV2WorkerConfig } from "./runtime-config";
import {
  OpenAISemanticOutlinePlanner,
  DocumentClarificationNeededError,
  understandDocumentRequest,
} from "./planning";
import { resolveDocumentTemplate } from "@/lib/document-v2/templates/resolver";
import { createDocumentPlanFromTemplate } from "@/lib/document-v2/planning/planner";
import { createDocumentOrchestrationState } from "@/lib/document-v2/orchestration/orchestrator";
import type { FigureAsset } from "@/lib/document-v2/assets/contracts";
import type { FinalDocumentSpec } from "@/lib/document-v2/contracts";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function adminClient(): SupabaseClient {
  const config = requireDocumentV2WorkerConfig();
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function claimNext(
  supabase: SupabaseClient,
  workerId: string,
  jobId?: string,
): Promise<DocumentJob | null> {
  const now = new Date();
  const lease = {
    target_worker_id: workerId,
    lease_now: now.toISOString(),
    lease_expires: new Date(now.getTime() + 4 * 60_000).toISOString(),
  };
  const { data, error } = jobId
    ? await supabase.rpc("claim_document_v2_dispatch", {
        ...lease,
        target_job_id: jobId,
      })
    : await supabase.rpc("claim_next_document_v2_dispatch", lease);
  if (error) throw error;
  return data ? DocumentJobSchema.parse(data) : null;
}

async function prepareIntake(input: {
  job: DocumentJob;
  repository: SupabaseDocumentJobRepository;
  textExecutor: DocumentStructuredTextExecutor;
}): Promise<DocumentJob> {
  const intake = input.job.checkpoint.intake;
  if (!intake) throw new Error("Document intake payload is missing.");
  let job = input.job;
  const advance = async (
    stage: "understanding" | "template_resolution" | "evidence_acquisition" | "planning",
    progress: number,
    message: string,
    operation = `stage.${stage}`,
  ) => {
    const now = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "running",
        stage,
        progress,
        updatedAt: now,
        startedAt: job.startedAt ?? now,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage,
      status: "started",
      message,
      category: stage === "evidence_acquisition" ? "validation" : "model",
      operation,
      correlationId: job.jobId,
      metadata: {
        jobRevision: job.revision,
        provider: input.textExecutor.profile.provider,
        modelId: input.textExecutor.profile.resolvedModelId,
      },
      createdAt: now,
    });
  };
  await advance("understanding", 2, "正在理解您的文档要求。");
  const understandingStartedAt = Date.now();
  let understood;
  try {
    understood = await understandDocumentRequest(input.textExecutor, {
      idempotencyKey: job.jobId,
      instruction: intake.instruction,
      source: intake.source,
      language: intake.language,
      targetLength: intake.targetLength,
      verifiedReferences: intake.verifiedReferences,
    });
  } catch (error) {
    if (!(error instanceof DocumentClarificationNeededError)) throw error;
    const now = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "awaiting_user_input",
        clarification: {
          questionId: randomUUID(),
          field: "topic_or_scope",
          question: error.question,
          reason: error.reason,
          required: true,
        },
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        checkpoint: {
          ...job.checkpoint,
          savedAt: now,
        },
        updatedAt: now,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: "understanding",
      status: "paused",
      message: error.question,
      category: "validation",
      operation: "request.clarification_required",
      correlationId: job.jobId,
      metadata: { reason: error.reason },
      createdAt: now,
    });
    return job;
  }
  await input.repository.appendEvent({
    eventId: randomUUID(),
    jobId: job.jobId,
    stage: "understanding",
    status: "succeeded",
    message: "文档要求理解完成。",
    category: "model",
    operation: "request.understand",
    correlationId: job.jobId,
    durationMs: Date.now() - understandingStartedAt,
    metadata: {
      provider: input.textExecutor.profile.provider,
      modelId: input.textExecutor.profile.resolvedModelId,
      language: understood.language,
      topicLength: understood.userRequirements.topic?.length ?? 0,
    },
    createdAt: new Date().toISOString(),
  });
  await advance("template_resolution", 4, "正在根据文档意图解析模板。");
  const template = await resolveDocumentTemplate({
    request: understood,
    matcher: {
      async match({ candidates }) {
        const candidate = candidates[0];
        if (!candidate) throw new Error("No compatible document template is enabled.");
        return {
          templateId: candidate.templateId,
          confidence: 1,
          rationale: "Resolved deterministically from template intent and compatibility.",
        };
      },
    },
  });
  await advance("evidence_acquisition", 6, "正在冻结可用于引用的证据。");
  const evidenceReferences = [
    ...new Map(
      intake.evidence.map((item) => [item.reference.id, item.reference]),
    ).values(),
  ];
  const planningStartedAt = Date.now();
  const plan = await createDocumentPlanFromTemplate({
    request: understood,
    template,
    outlinePlanner: new OpenAISemanticOutlinePlanner(input.textExecutor),
    availableEvidenceIds: evidenceReferences.map((reference) => reference.id),
  });
  await input.repository.appendEvent({
    eventId: randomUUID(),
    jobId: job.jobId,
    stage: "planning",
    status: "succeeded",
    message: "文档结构规划完成。",
    category: "model",
    operation: "outline.plan",
    correlationId: job.jobId,
    durationMs: Date.now() - planningStartedAt,
    metadata: {
      provider: input.textExecutor.profile.provider,
      modelId: input.textExecutor.profile.resolvedModelId,
      componentCount: plan.components.length,
      evidenceCount: evidenceReferences.length,
      templateId: template.snapshot.templateId,
    },
    createdAt: new Date().toISOString(),
  });
  await advance("planning", 8, "文档结构已经规划完成。");
  const orchestration = createDocumentOrchestrationState({
    jobId: job.jobId,
    request: understood,
    plan,
    verifiedReferences: evidenceReferences,
    evidenceBundle: intake.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      excerpt: item.excerpt,
      locator: item.locator,
    })),
  });
  const evidenceSnapshotId =
    intake.evidence.length > 0
      ? `evidence-${createHash("sha256")
          .update(JSON.stringify(intake.evidence))
          .digest("hex")
          .slice(0, 24)}`
      : undefined;
  const now = new Date().toISOString();
  job = await input.repository.save(
    DocumentJobSchema.parse({
      ...job,
      status: "running",
      stage: "planning",
      progress: 8,
      totalComponents: orchestration.components.length,
      checkpoint: {
        ...job.checkpoint,
        orchestration,
        executionSnapshot: {
          requestSchemaVersion: "1",
          planSchemaVersion: "1",
          finalSpecSchemaVersion: "1",
          intentPromptVersion: "document-request-v1",
          plannerPromptVersion: "document-outline-v1",
          generatorPromptVersion: "document-component-v1",
          validatorVersion: "mature-content-v1",
          modelProvider: input.textExecutor.profile.provider,
          modelId: input.textExecutor.profile.resolvedModelId,
          rendererVersion: "sci-word-v1",
          templateChecksum: template.snapshot.checksum,
          evidenceSnapshotId,
        },
        budget: {
          maxModelCalls: 24,
          maxImageCalls: 8,
          maxImageAssets: 4,
          maxRepairAttempts: 8,
          maxExecutionMs: 15 * 60_000,
          usedModelCalls: 2,
          usedImageCalls: 0,
          completedImageAssets: 0,
          usedRepairAttempts: 0,
          usedExecutionMs: 0,
        },
        savedAt: now,
      },
      updatedAt: now,
    }),
    job.revision,
  );
  return job;
}

async function storeDocx(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  buffer: Buffer,
): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("word/document.xml")) throw new Error("Rendered DOCX is invalid.");
  const id = randomUUID();
  const filename = `researchgpt-${jobId}.docx`;
  const storagePath = `${ownerId}/exports/${id}-${filename}`;
  const metaPath = `${ownerId}/exports/${id}.meta.json`;
  const record: ExportRecord = {
    id,
    filename,
    mimeType: DOCX_MIME,
    userId: ownerId,
    createdAt: Date.now(),
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
  };
  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const uploaded = await bucket.upload(storagePath, buffer, {
    contentType: DOCX_MIME,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;
  const metadata = await bucket.upload(
    metaPath,
    Buffer.from(JSON.stringify(record), "utf8"),
    { contentType: "application/json; charset=utf-8", upsert: false },
  );
  if (metadata.error) {
    await bucket.remove([storagePath]);
    throw metadata.error;
  }
  return id;
}

async function storeFigureAsset(
  supabase: SupabaseClient,
  ownerId: string,
  jobId: string,
  asset: FigureAsset,
): Promise<FigureAsset> {
  if (!asset.dataBase64) return asset;
  const basePath = `${ownerId}/document-v2/${jobId}/figures/${asset.requestId}/${asset.sha256}`;
  const storagePath = `${basePath}.${asset.format}`;
  const fallbackStoragePath =
    asset.format === "svg" ? `${basePath}.fallback.png` : undefined;
  const bucket = supabase.storage.from(CHAT_ATTACHMENTS_BUCKET);
  const data = Buffer.from(asset.dataBase64, "base64");
  const uploaded = await bucket.upload(storagePath, data, {
    contentType: asset.format === "svg" ? "image/svg+xml" : "image/png",
    upsert: false,
  });
  if (uploaded.error && !/already exists/i.test(uploaded.error.message)) {
    throw uploaded.error;
  }
  if (fallbackStoragePath && asset.fallbackPngBase64) {
    const fallback = await bucket.upload(
      fallbackStoragePath,
      Buffer.from(asset.fallbackPngBase64, "base64"),
      { contentType: "image/png", upsert: false },
    );
    if (fallback.error && !/already exists/i.test(fallback.error.message)) {
      throw fallback.error;
    }
  }
  return {
    ...asset,
    dataBase64: undefined,
    fallbackPngBase64: undefined,
    storageBucket: CHAT_ATTACHMENTS_BUCKET,
    storagePath,
    fallbackStoragePath,
    byteSize: data.byteLength,
  };
}

async function hydrateFigureAssets(
  supabase: SupabaseClient,
  spec: FinalDocumentSpec,
): Promise<FinalDocumentSpec> {
  const assets = await Promise.all(
    spec.assets.map(async (asset) => {
      if (asset.dataBase64) return asset;
      if (!asset.storageBucket || !asset.storagePath) {
        throw new Error(`Figure asset "${asset.id}" has no storage reference.`);
      }
      const bucket = supabase.storage.from(asset.storageBucket);
      const downloaded = await bucket.download(asset.storagePath);
      if (downloaded.error || !downloaded.data) {
        throw downloaded.error ?? new Error(`Figure asset "${asset.id}" is missing.`);
      }
      let fallbackPngBase64: string | undefined;
      if (asset.fallbackStoragePath) {
        const fallback = await bucket.download(asset.fallbackStoragePath);
        if (fallback.error || !fallback.data) {
          throw fallback.error ?? new Error(`Figure fallback "${asset.id}" is missing.`);
        }
        fallbackPngBase64 = Buffer.from(
          await fallback.data.arrayBuffer(),
        ).toString("base64");
      }
      return {
        ...asset,
        dataBase64: Buffer.from(await downloaded.data.arrayBuffer()).toString(
          "base64",
        ),
        fallbackPngBase64,
      };
    }),
  );
  return { ...spec, assets };
}

export async function executeOneDocumentV2Tick(jobId?: string) {
  const config = requireDocumentV2WorkerConfig();
  const supabase = adminClient();
  const workerId = `vercel-${randomUUID()}`;
  let job = await claimNext(supabase, workerId, jobId);
  if (!job) return { state: "idle" as const };

  const openai = new OpenAI({
    apiKey: config.openAiApiKey,
    timeout: 75_000,
    maxRetries: 0,
  });
  const repository = new SupabaseDocumentJobRepository(supabase, job.ownerId);
  if (!job.checkpoint.dispatchToken) {
    const now = new Date().toISOString();
    job = await repository.save(
      DocumentJobSchema.parse({
        ...job,
        checkpoint: {
          ...job.checkpoint,
          dispatchToken:
            randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
          savedAt: now,
        },
        updatedAt: now,
      }),
      job.revision,
    );
  }
  const textExecution = job.checkpoint.textExecution ?? {
    provider: "openai" as const,
    requestedModelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
    resolvedModelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
    maxOutputTokens: 7_000,
    allowProviderFallback: false as const,
  };
  const recordUsage = async (usage: DocumentModelUsage) => {
    const currentJob = await repository.get(job.jobId);
    await repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: currentJob?.stage ?? job.stage,
      status: "succeeded",
      message: `模型调用完成：${usage.operation}`,
      category: "model",
      operation: "model.call.succeeded",
      correlationId: usage.providerRequestId ?? usage.inputFingerprint.slice(0, 120),
      componentKey: usage.componentKey,
      durationMs: usage.durationMs,
      metadata: {
        provider: usage.provider,
        requestedModelId: usage.requestedModelId,
        actualModelId: usage.actualModelId,
        providerRequestId: usage.providerRequestId ?? null,
        modelOperation: usage.operation,
        inputFingerprint: usage.inputFingerprint,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningTokens: usage.reasoningTokens,
        calculatedCostUsd: usage.calculatedCostUsd,
      },
      createdAt: new Date().toISOString(),
    });
  };
  const textExecutor = new ProviderDocumentTextExecutor(
    textExecution,
    recordUsage,
    { supabase, jobId: job.jobId },
  );
  await repository.appendEvent({
    eventId: randomUUID(),
    jobId: job.jobId,
    stage: job.stage,
    status: "started",
    message: "后台工作器已领取任务。",
    category: "dispatch",
    operation: "dispatch.claimed",
    correlationId: workerId,
    metadata: {
      jobRevision: job.revision,
      leaseExpiresAt: job.leaseExpiresAt ?? null,
    },
    createdAt: new Date().toISOString(),
  });
  let preparedJob = job.checkpoint.orchestration
    ? job
    : await prepareIntake({ job, repository, textExecutor });
  if (preparedJob.status === "awaiting_user_input") {
    return {
      state: preparedJob.status,
      jobId: preparedJob.jobId,
      stage: preparedJob.stage,
      progress: preparedJob.progress,
    };
  }
  const orchestration = preparedJob.checkpoint.orchestration;
  if (
    orchestration?.figures.some(
      (figure) => figure.asset?.dataBase64,
    )
  ) {
    const figures = await Promise.all(
      orchestration.figures.map(async (figure) => ({
        ...figure,
        asset: figure.asset
          ? await storeFigureAsset(
              supabase,
              preparedJob.ownerId,
              preparedJob.jobId,
              figure.asset,
            )
          : undefined,
      })),
    );
    const savedAt = new Date().toISOString();
    preparedJob = await repository.save(
      DocumentJobSchema.parse({
        ...preparedJob,
        checkpoint: {
          ...preparedJob.checkpoint,
          orchestration: { ...orchestration, figures },
          savedAt,
        },
        updatedAt: savedAt,
      }),
      preparedJob.revision,
    );
  }
  const imageModel =
    process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5";
  const validatedFigurePipeline = new ValidatedFigureAssetPipeline(
    new OpenAIFinalFigureGenerator(openai, imageModel),
  );
  const service = new DocumentV2JobService(
    repository,
    {
      generator: new ModelDocumentComponentGenerator(
        new OpenAIStructuredComponentModel(textExecutor),
      ),
      validator: new MatureDocumentComponentValidator(),
      figureAssetMaterializer: {
        async materialize(request, context) {
          const asset = await validatedFigurePipeline.materialize(
            request,
            context,
          );
          return storeFigureAsset(
            supabase,
            preparedJob.ownerId,
            preparedJob.jobId,
            asset,
          );
        },
      },
      maxAttemptsPerComponent: 2,
    },
    {
      async renderAndStore({ jobId, spec, shouldCancel }) {
        const hydratedSpec = await hydrateFigureAssets(supabase, spec);
        const buffer = await renderFinalDocumentSpecToDocx(hydratedSpec);
        if (await shouldCancel()) throw new Error("Document job was cancelled.");
        return {
          artifactId: await storeDocx(
            supabase,
            job.ownerId,
            jobId,
            buffer,
          ),
        };
      },
      async validateArtifact({ artifactId, shouldCancel }) {
        if (await shouldCancel()) throw new Error("Document job was cancelled.");
        const metaPath = `${job.ownerId}/exports/${artifactId}.meta.json`;
        const metadata = await supabase.storage
          .from(CHAT_ATTACHMENTS_BUCKET)
          .download(metaPath);
        if (metadata.error || !metadata.data) {
          throw metadata.error ?? new Error("Rendered DOCX metadata is missing.");
        }
        const record = JSON.parse(await metadata.data.text()) as ExportRecord;
        if (!record.storageBucket || !record.storagePath) {
          throw new Error("Rendered DOCX metadata is incomplete.");
        }
        const file = await supabase.storage
          .from(record.storageBucket)
          .download(record.storagePath);
        if (file.error || !file.data) {
          throw file.error ?? new Error("Rendered DOCX is missing.");
        }
        const buffer = Buffer.from(await file.data.arrayBuffer());
        const zip = await JSZip.loadAsync(buffer);
        if (!zip.file("word/document.xml")) {
          throw new Error("Rendered DOCX is invalid.");
        }
      },
    },
  );
  const configuredBudget = Number(
    process.env.DOCUMENT_V2_WORKER_BUDGET_MS ?? "45000",
  );
  const maxDurationMs =
    Number.isFinite(configuredBudget) && configuredBudget >= 5_000
      ? Math.min(configuredBudget, 240_000)
      : 45_000;
  const snapshot = await service.run(preparedJob.jobId, workerId, {
    maxComponents: 1,
    maxDurationMs,
  });
  return {
    state: snapshot.job.status,
    jobId: snapshot.job.jobId,
    stage: snapshot.job.stage,
    progress: snapshot.job.progress,
  };
}
