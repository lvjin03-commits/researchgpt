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
  DocumentModelExecutionRequiresReviewError,
  DocumentModelOperationError,
  type DocumentModelUsage,
  type DocumentStructuredTextExecutor,
} from "./text-executor";
import { requireDocumentV2WorkerConfig } from "./runtime-config";
import {
  ModelHierarchicalOutlinePlanner,
  DocumentClarificationNeededError,
  understandDocumentRequest,
} from "./planning";
import { resolveDocumentTemplate } from "@/lib/document-v2/templates/resolver";
import {
  assembleSemanticOutline,
  createDocumentPlanFromProposal,
  createValidatedSectionIndex,
  materializeDocumentStructure,
  materializeFigureIntents,
  materializeSectionPlan,
  OutlineLanguageMismatchError,
} from "@/lib/document-v2/planning/planner";
import {
  createDocumentExecutionBudgetSnapshot,
  DOCUMENT_OPERATION_BUDGET_POLICY_VERSION,
} from "@/lib/document-v2/runtime/token-budgets";
import { createDocumentOrchestrationState } from "@/lib/document-v2/orchestration/orchestrator";
import type { FigureAsset } from "@/lib/document-v2/assets/contracts";
import type { FinalDocumentSpec } from "@/lib/document-v2/contracts";
import {
  createReferenceExecutionProfile,
} from "@/lib/document-v2/references/contracts";
import {
  acquireDocumentReferences,
  createReferencePipelineFallback,
} from "@/lib/document-v2/references/acquisition";

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

function workerFailureDetails(error: unknown) {
  if (error instanceof OutlineLanguageMismatchError) {
    return {
      code: error.failureCategory,
      category: error.failureCategory,
      operation: error.sourceComponent,
      technicalMessage: JSON.stringify(error.diagnosticDetails()),
    };
  }
  if (error instanceof DocumentModelOperationError) {
    return {
      code: `document_model_${error.failureCategory}`,
      category: error.failureCategory,
      operation: error.operation ?? "model.generate",
      technicalMessage: error.message,
    };
  }
  if (error instanceof DocumentModelExecutionRequiresReviewError) {
    return {
      code: `document_model_${error.executionStatus}`,
      category: error.executionStatus,
      operation: "model.execution.review",
      technicalMessage: error.message,
    };
  }
  return {
    code: "document_worker_failed",
    category: "worker_failure",
    operation: "worker.tick",
    technicalMessage: error instanceof Error ? error.message : String(error),
  };
}

async function finalizeWorkerFailure(input: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  error: unknown;
}): Promise<DocumentJob | null> {
  const failure = workerFailureDetails(input.error);
  const { data, error } = await input.supabase.rpc(
    "finalize_document_v2_worker_failure",
    {
      target_job_id: input.jobId,
      expected_worker_id: input.workerId,
      failure_code: failure.code.slice(0, 120),
      failure_category: failure.category.slice(0, 120),
      failure_operation: failure.operation.slice(0, 120),
      failure_user_message:
        "文档生成在当前阶段暂停，请查看运行详情后重试。",
      failure_technical_message: failure.technicalMessage.slice(0, 2_000),
      failed_at: new Date().toISOString(),
    },
  );
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
  const saveAndContinue = async (
    planning: NonNullable<DocumentJob["checkpoint"]["planning"]>,
    progress: number,
  ) => {
    const now = new Date().toISOString();
    return input.repository.save(DocumentJobSchema.parse({
      ...job,
      status: "queued",
      stage: "planning",
      progress,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      checkpoint: { ...job.checkpoint, planning, savedAt: now },
      startedAt: job.startedAt ?? now,
      updatedAt: now,
    }), job.revision);
  };
  const logSaved = async (operation: string, message: string, metadata: Record<string, string | number | boolean | null>, componentKey?: string) => {
    await input.repository.appendEvent({
      eventId: randomUUID(), jobId: job.jobId, stage: "planning", status: "succeeded",
      message, category: operation === "outline.assemble" ? "validation" : "model",
      operation, correlationId: job.jobId, componentKey, metadata,
      createdAt: new Date().toISOString(),
    });
  };
  const planner = new ModelHierarchicalOutlinePlanner(input.textExecutor);
  let planning = job.checkpoint.planning;

  if (!planning) {
    const startedAt = new Date().toISOString();
    job = await input.repository.save(DocumentJobSchema.parse({
      ...job, status: "running", stage: "understanding", progress: 2,
      startedAt: job.startedAt ?? startedAt, updatedAt: startedAt,
    }), job.revision);
    await input.repository.appendEvent({
      eventId: randomUUID(), jobId: job.jobId, stage: "understanding", status: "started",
      message: "Understanding the document request.", category: "model",
      operation: "request.understand", correlationId: job.jobId,
      metadata: { provider: input.textExecutor.profile.provider, modelId: input.textExecutor.profile.resolvedModelId },
      createdAt: startedAt,
    });
    let request;
    try {
      request = await understandDocumentRequest(input.textExecutor, {
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
      job = await input.repository.save(DocumentJobSchema.parse({
        ...job,
        status: "awaiting_user_input",
        clarification: { questionId: randomUUID(), field: "topic_or_scope", question: error.question, reason: error.reason, required: true },
        leaseOwner: undefined, leaseExpiresAt: undefined,
        checkpoint: { ...job.checkpoint, savedAt: now }, updatedAt: now,
      }), job.revision);
      await input.repository.appendEvent({
        eventId: randomUUID(), jobId: job.jobId, stage: "understanding", status: "paused",
        message: error.question, category: "validation", operation: "request.clarification_required",
        correlationId: job.jobId, metadata: { reason: error.reason }, createdAt: now,
      });
      return job;
    }
    const template = await resolveDocumentTemplate({
      request,
      matcher: { async match({ candidates }) {
        const candidate = candidates[0];
        if (!candidate) throw new Error("No compatible document template is enabled.");
        return { templateId: candidate.templateId, confidence: 1, rationale: "Resolved deterministically from template intent and compatibility." };
      } },
    });
    const evidenceReferences = [...new Map([
      ...(intake.verifiedReferences ?? []),
      ...intake.evidence.map((item) => item.reference),
    ].map((reference) => [reference.id, reference])).values()];
    const evidenceSnapshotId = intake.evidence.length > 0
      ? `evidence-${createHash("sha256").update(JSON.stringify(intake.evidence)).digest("hex").slice(0, 24)}`
      : undefined;
    const referenceExecution = createReferenceExecutionProfile({
      requirement: request.userRequirements.citationRequirement,
      policy: request.userRequirements.referencePolicy,
      hasUserReferences:
        evidenceReferences.length > 0 || intake.evidence.length > 0,
      runtimeEnabled:
        process.env.DOCUMENT_V2_REFERENCE_PIPELINE_ENABLED !== "false",
    });
    const referenceResult = referenceExecution.enabled
      ? undefined
      : await acquireDocumentReferences({
          profile: referenceExecution,
          topic: request.userRequirements.topic ?? "",
          existingReferences: evidenceReferences,
          existingEvidence: intake.evidence,
        });
    planning = {
      schemaVersion: 1,
      request,
      template,
      evidenceReferences,
      evidenceSnapshotId,
      planningRevision: 1,
      figureIntentsCompleted: false,
      sectionPlans: [],
      planningInvalidations: [],
    };
    job = DocumentJobSchema.parse({
      ...job,
      checkpoint: {
        ...job.checkpoint,
        referenceExecution,
        referenceResult,
      },
    });
    job = await saveAndContinue(planning, 5);
    await logSaved("planning.context.saved", "Document request, template, and evidence context were saved.", {
      templateId: template.snapshot.templateId, evidenceCount: evidenceReferences.length,
    });
    return job;
  }

  const sectionBlueprint = planning.template.componentBlueprints.find((item) => item.type === "section");
  if (!sectionBlueprint) throw new Error("Resolved template does not contain a section blueprint.");
  if (!planning.thesis) {
    const thesis = await planner.createThesis({
      request: planning.request,
      template: planning.template,
      planningRevision: planning.planningRevision,
    });
    planning = { ...planning, thesis };
    job = await saveAndContinue(planning, 6);
    await logSaved("outline.thesis", "Document thesis and scope saved.", {
      planningRevision: planning.planningRevision,
    });
    return job;
  }

  if (!planning.skeleton) {
    const sectionIndex = await createValidatedSectionIndex({
      planner,
      request: planning.request,
      template: planning.template,
      thesis: planning.thesis,
      minimumSections: sectionBlueprint.minimumCount,
      maximumSections: sectionBlueprint.maximumCount,
      planningRevision: planning.planningRevision,
    });
    const skeleton = materializeDocumentStructure({
      thesis: planning.thesis,
      sectionIndex,
    });
    planning = { ...planning, skeleton };
    job = await saveAndContinue(planning, 7);
    await logSaved("outline.section_index", "Document section index saved.", {
      sectionCount: skeleton.sections.length,
      planningRevision: planning.planningRevision,
    });
    return job;
  }

  const referenceExecution = job.checkpoint.referenceExecution;
  if (referenceExecution?.enabled && !job.checkpoint.referenceResult) {
    const acquisitionStartedAt = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "running",
        stage: "evidence_acquisition",
        progress: 7,
        updatedAt: acquisitionStartedAt,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: "evidence_acquisition",
      status: "started",
      message: "正在获取并核验可用于正文引用的参考文献。",
      category: "lifecycle",
      operation: "references.acquire",
      correlationId: job.jobId,
      createdAt: acquisitionStartedAt,
    });
    let referenceResult;
    let referenceFailureMessage: string | undefined;
    try {
      referenceResult = await acquireDocumentReferences({
        profile: referenceExecution,
        topic: planning.request.userRequirements.topic ?? "",
        existingReferences: planning.evidenceReferences,
        existingEvidence: intake.evidence,
      });
    } catch (error) {
      referenceFailureMessage =
        error instanceof Error ? error.message : String(error);
      referenceResult = createReferencePipelineFallback({
        existingReferences: planning.evidenceReferences,
        existingEvidence: intake.evidence,
      });
    }
    const evidenceReferences = referenceResult.verifiedReferences;
    const evidenceSnapshotId =
      referenceResult.evidence.length > 0
        ? `evidence-${createHash("sha256")
            .update(JSON.stringify(referenceResult.evidence))
            .digest("hex")
            .slice(0, 24)}`
        : planning.evidenceSnapshotId;
    planning = {
      ...planning,
      evidenceReferences,
      evidenceSnapshotId,
    };
    const savedAt = new Date().toISOString();
    job = await input.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "queued",
        stage: "planning",
        progress: 7,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        referenceOutcome: referenceResult.outcome,
        referenceWarnings: referenceResult.warnings,
        checkpoint: {
          ...job.checkpoint,
          planning,
          referenceResult,
          savedAt,
        },
        updatedAt: savedAt,
      }),
      job.revision,
    );
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage: "evidence_acquisition",
      status:
        referenceResult.outcome === "complete" ? "succeeded" : "progress",
      message:
        referenceResult.outcome === "complete"
          ? `已获得${referenceResult.verifiedReferences.length}篇可验证参考文献。`
          : referenceResult.warnings.at(-1)?.message ??
            "参考文献获取已完成，将按当前可用结果继续生成文档。",
      category: "validation",
      operation: "references.acquire.completed",
      correlationId: job.jobId,
      metadata: {
        outcome: referenceResult.outcome,
        candidateCount: referenceResult.candidateCount,
        verifiedCount: referenceResult.verifiedReferences.length,
        providerCalls: referenceResult.providerCalls,
        durationMs: referenceResult.durationMs,
      },
      errorCode: referenceFailureMessage
        ? "reference_pipeline_failed"
        : undefined,
      technicalMessage: referenceFailureMessage?.slice(0, 2_000),
      createdAt: savedAt,
    });
    return job;
  }

  const availableEvidence = [
    ...intake.evidence,
    ...(job.checkpoint.referenceResult?.evidence ?? []),
  ];
  const availableEvidenceIds = [
    ...new Set(availableEvidence.map((item) => item.evidenceId)),
  ];

  if (!planning.figureIntentsCompleted) {
    const figureDraft =
      planning.request.userRequirements.visualIntent === "forbidden"
        ? { figures: [] }
        : await planner.planFigureIntents({
            request: planning.request,
            template: planning.template,
            skeleton: planning.skeleton,
            evidenceContext: {
              verifiedEvidenceAvailable: availableEvidenceIds.length > 0,
              verifiedEvidenceCount: availableEvidenceIds.length,
            },
            planningRevision: planning.planningRevision,
          });
    const skeleton = materializeFigureIntents({
      skeleton: planning.skeleton,
      draft: figureDraft,
    });
    planning = {
      ...planning,
      skeleton,
      figureIntentsCompleted: true,
    };
    job = await saveAndContinue(planning, 8);
    await logSaved(
      "outline.figure_intents",
      planning.request.userRequirements.visualIntent === "forbidden"
        ? "Figure planning skipped because the user forbade figures."
        : "Document figure intents saved.",
      {
        figureCount: skeleton.figures.length,
        skipped:
          planning.request.userRequirements.visualIntent === "forbidden",
      },
    );
    return job;
  }

  const skeleton = planning.skeleton;
  const planned = new Set(planning.sectionPlans.map((item) => item.sectionId));
  const section = skeleton.sections.find((item) => !planned.has(item.sectionId));
  if (section) {
    const sectionPlan = materializeSectionPlan({
      sectionId: section.sectionId,
      draft: await planner.planSection({
        request: planning.request, template: planning.template, skeleton, section,
        availableEvidenceIds,
        availableEvidence: availableEvidence.map((item) => ({
          evidenceId: item.evidenceId,
          excerpt: item.excerpt,
        })),
        planningRevision: planning.planningRevision,
      }),
    });
    planning = { ...planning, sectionPlans: [...planning.sectionPlans, sectionPlan] };
    const progress = 8 + Math.round((planning.sectionPlans.length / skeleton.sections.length) * 4);
    job = await saveAndContinue(planning, progress);
    await logSaved("outline.section_plan", `Section plan saved: ${section.heading}`, {
      plannedSections: planning.sectionPlans.length, totalSections: skeleton.sections.length,
    }, section.sectionId);
    return job;
  }

  const proposal = assembleSemanticOutline({ skeleton, sectionPlans: planning.sectionPlans });
  const plan = createDocumentPlanFromProposal({
    request: planning.request, template: planning.template, proposal,
    availableEvidenceIds,
  });
  const orchestration = createDocumentOrchestrationState({
    jobId: job.jobId, request: planning.request, plan,
    verifiedReferences: planning.evidenceReferences,
    evidenceBundle: availableEvidence.map((item) => ({
      evidenceId: item.evidenceId,
      excerpt: item.excerpt,
      locator: item.locator,
    })),
  });
  const now = new Date().toISOString();
  job = await input.repository.save(DocumentJobSchema.parse({
    ...job, status: "running", stage: "planning", progress: 12,
    totalComponents: orchestration.components.length,
    checkpoint: {
      ...job.checkpoint, planning, orchestration,
      executionSnapshot: {
        requestSchemaVersion: "1", planSchemaVersion: "1", finalSpecSchemaVersion: "1",
        intentPromptVersion: "document-request-v1", plannerPromptVersion: "document-hierarchical-outline-v2",
        generatorPromptVersion: "document-component-contract-v2", validatorVersion: "mature-content-v1",
        modelProvider: input.textExecutor.profile.provider, modelId: input.textExecutor.profile.resolvedModelId,
        rendererVersion: "sci-word-v1", templateChecksum: planning.template.snapshot.checksum,
        evidenceSnapshotId: planning.evidenceSnapshotId,
      },
      budget: {
        maxModelCalls: Math.max(32, orchestration.components.length + planning.sectionPlans.length + 12),
        maxImageCalls: 8, maxImageAssets: 4, maxRepairAttempts: 8,
        maxExecutionMs: 15 * 60_000, usedModelCalls: 2 + planning.sectionPlans.length,
        usedImageCalls: 0, completedImageAssets: 0, usedRepairAttempts: 0, usedExecutionMs: 0,
      }, savedAt: now,
    }, updatedAt: now,
  }), job.revision);
  await logSaved("outline.assemble", "Hierarchical document plan assembled.", {
    componentCount: plan.components.length, sectionCount: planning.sectionPlans.length,
  });
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
  const claimedJob = job;

  const repository = new SupabaseDocumentJobRepository(
    supabase,
    claimedJob.ownerId,
  );
  try {
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
  const textExecution = job.checkpoint.textExecution;
  if (!textExecution) {
    throw new Error(
      "legacy_text_execution_profile_missing: the document job has no frozen text model configuration.",
    );
  }
  if (
    !job.checkpoint.executionBudget ||
    job.checkpoint.executionBudget.operationBudgetPolicyVersion !==
      DOCUMENT_OPERATION_BUDGET_POLICY_VERSION
  ) {
    const now = new Date().toISOString();
    job = await repository.save(
      DocumentJobSchema.parse({
        ...job,
        checkpoint: {
          ...job.checkpoint,
          executionBudget: createDocumentExecutionBudgetSnapshot(
            textExecution,
            now,
          ),
          savedAt: now,
        },
        updatedAt: now,
      }),
      job.revision,
    );
  }
  const executionBudget = job.checkpoint.executionBudget;
  if (!executionBudget) {
    throw new Error("document_execution_budget_snapshot_missing");
  }
  const recordUsage = async (usage: DocumentModelUsage) => {
    const currentJob = await repository.get(claimedJob.jobId);
    await repository.appendEvent({
      eventId: randomUUID(),
      jobId: claimedJob.jobId,
      stage: currentJob?.stage ?? claimedJob.stage,
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
        requestedMaxOutputTokens: usage.requestedMaxOutputTokens,
        effectiveMaxOutputTokens: usage.effectiveMaxOutputTokens,
        expectedOutputTokens: usage.expectedOutputTokens ?? null,
        operationHardMaxOutputTokens:
          usage.operationHardMaxOutputTokens ?? null,
        inputFingerprint: usage.inputFingerprint,
        generationConfigFingerprint: usage.generationConfigFingerprint,
        modelAttempt: usage.attemptNumber,
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
    executionBudget,
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
  if (!preparedJob.checkpoint.orchestration) {
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
  const service = new DocumentV2JobService(
    repository,
    {
      generator: new ModelDocumentComponentGenerator(
        new OpenAIStructuredComponentModel(textExecutor),
      ),
      validator: new MatureDocumentComponentValidator(),
      figureAssetMaterializer: {
        async materialize(request, context) {
          if (!config.openAiApiKey) {
            throw new Error(
              "openai_image_provider_not_configured: this job requires a complex image but OPENAI_API_KEY is unavailable.",
            );
          }
          const validatedFigurePipeline = new ValidatedFigureAssetPipeline(
            new OpenAIFinalFigureGenerator(
              new OpenAI({
                apiKey: config.openAiApiKey,
                timeout: 75_000,
                maxRetries: 0,
              }),
              process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
            ),
          );
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
            claimedJob.ownerId,
            jobId,
            buffer,
          ),
        };
      },
      async validateArtifact({ artifactId, shouldCancel }) {
        if (await shouldCancel()) throw new Error("Document job was cancelled.");
        const metaPath = `${claimedJob.ownerId}/exports/${artifactId}.meta.json`;
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
    alreadyClaimedJob: preparedJob,
  });
  return {
    state: snapshot.job.status,
    jobId: snapshot.job.jobId,
    stage: snapshot.job.stage,
    progress: snapshot.job.progress,
    failureCode: snapshot.job.error?.code,
    failedComponentKey: snapshot.job.error?.componentKey,
    failureMessage: snapshot.job.error?.technicalMessage.slice(0, 500),
  };
  } catch (error) {
    const finalized = await finalizeWorkerFailure({
      supabase,
      jobId: claimedJob.jobId,
      workerId,
      error,
    });
    if (!finalized) throw error;
    return {
      state: finalized.status,
      jobId: finalized.jobId,
      stage: finalized.stage,
      progress: finalized.progress,
      failureCode: finalized.error?.code,
      failureMessage: finalized.error?.technicalMessage.slice(0, 500),
    };
  }
}
