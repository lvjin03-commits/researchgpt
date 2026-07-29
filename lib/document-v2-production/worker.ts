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
  OpenAISemanticOutlinePlanner,
  DocumentClarificationNeededError,
  understandDocumentRequest,
} from "./planning";
import { resolveDocumentTemplate } from "@/lib/document-v2/templates/resolver";
import { createDocumentPlanFromTemplate } from "@/lib/document-v2/planning/planner";
import { createDocumentOrchestrationState } from "@/lib/document-v2/orchestration/orchestrator";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Background worker database credentials are missing.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function claimNext(
  supabase: SupabaseClient,
  workerId: string,
): Promise<DocumentJob | null> {
  const now = new Date();
  const { data, error } = await supabase.rpc("claim_next_document_v2_dispatch", {
    target_worker_id: workerId,
    lease_now: now.toISOString(),
    lease_expires: new Date(now.getTime() + 4 * 60_000).toISOString(),
  });
  if (error) throw error;
  return data ? DocumentJobSchema.parse(data) : null;
}

async function prepareIntake(input: {
  job: DocumentJob;
  repository: SupabaseDocumentJobRepository;
  openai: OpenAI;
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
        modelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
      },
      createdAt: now,
    });
  };
  await advance("understanding", 2, "正在理解您的文档要求。");
  const understandingStartedAt = Date.now();
  let understood;
  try {
    understood = await understandDocumentRequest(input.openai, {
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
      modelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
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
    outlinePlanner: new OpenAISemanticOutlinePlanner(input.openai),
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
      modelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
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
          modelProvider: "openai",
          modelId: process.env.OPENAI_DOCUMENT_MODEL ?? "gpt-5.2",
          rendererVersion: "sci-word-v1",
          templateChecksum: template.snapshot.checksum,
          evidenceSnapshotId,
        },
        budget: {
          maxModelCalls: 24,
          maxImageCalls: 4,
          maxRepairAttempts: 8,
          maxExecutionMs: 15 * 60_000,
          usedModelCalls: 2,
          usedImageCalls: 0,
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

export async function executeOneDocumentV2Tick() {
  const supabase = adminClient();
  const workerId = `vercel-${randomUUID()}`;
  const job = await claimNext(supabase, workerId);
  if (!job) return { state: "idle" as const };

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const repository = new SupabaseDocumentJobRepository(supabase, job.ownerId);
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
  const preparedJob = job.checkpoint.orchestration
    ? job
    : await prepareIntake({ job, repository, openai });
  if (preparedJob.status === "awaiting_user_input") {
    return {
      state: preparedJob.status,
      jobId: preparedJob.jobId,
      stage: preparedJob.stage,
      progress: preparedJob.progress,
    };
  }
  const documentModel =
    preparedJob.checkpoint.executionSnapshot?.modelId ??
    process.env.OPENAI_DOCUMENT_MODEL ??
    "gpt-5.2";
  const imageModel =
    process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5";
  const service = new DocumentV2JobService(
    repository,
    {
      generator: new ModelDocumentComponentGenerator(
        new OpenAIStructuredComponentModel(openai, documentModel),
      ),
      validator: new MatureDocumentComponentValidator(),
      figureAssetMaterializer: new ValidatedFigureAssetPipeline(
        new OpenAIFinalFigureGenerator(openai, imageModel),
      ),
      maxAttemptsPerComponent: 2,
    },
    {
      async renderAndStore({ jobId, spec, onStage, shouldCancel }) {
        await onStage("docx_rendering");
        const buffer = await renderFinalDocumentSpecToDocx(spec);
        if (await shouldCancel()) throw new Error("Document job was cancelled.");
        await onStage("quality_check");
        await onStage("artifact_storage");
        return {
          artifactId: await storeDocx(
            supabase,
            job.ownerId,
            jobId,
            buffer,
          ),
        };
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
  const snapshot = await service.run(preparedJob.jobId, workerId, { maxDurationMs });
  return {
    state: snapshot.job.status,
    jobId: snapshot.job.jobId,
    stage: snapshot.job.stage,
    progress: snapshot.job.progress,
  };
}
