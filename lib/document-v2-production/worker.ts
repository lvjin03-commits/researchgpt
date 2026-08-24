import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DocumentJobSchema, type DocumentJob } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { ModelDocumentComponentGenerator } from "@/lib/document-v2/generation/model-component-generator";
import { MatureDocumentComponentValidator } from "@/lib/document-v2/generation/mature-content-validator";
import {
  OpenAIStructuredComponentModel,
} from "./openai-adapters";
import {
  ProviderDocumentTextExecutor,
  type DocumentModelUsage,
} from "./text-executor";
import { requireDocumentV2WorkerConfig } from "./runtime-config";
import {
  createDocumentExecutionBudgetSnapshot,
  DOCUMENT_OPERATION_BUDGET_POLICY_VERSION,
} from "@/lib/document-v2/runtime/token-budgets";
import {
  createImageExecutionProfile,
} from "@/lib/document-v2/assets/execution-policy";
import { documentFailureUserMessage } from "@/lib/document-v2/domain/failures";
import { mapWorkerFailure } from "./failure-mapper";
import {
  storeFigureAsset,
} from "./artifact-storage";
import { createDocumentFinalizer } from "./document-finalizer";
import { createFigureAssetMaterializer } from "./figure-materializer";
import { prepareIntake } from "./stages/intake";
import { prepareOptionalDocumentResearch } from "./research-preparation";
import { AiUsageIntegration } from "@/lib/billing/application/ai-usage-integration";
import { SupabaseAiUsageEventSink } from "@/lib/billing/infrastructure/supabase/supabase-ai-usage-event-sink";
import { tokenUsage } from "@/lib/ai/billable-usage";
import { assertRegisteredAiOperation } from "@/lib/ai/operation-registry";

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

async function finalizeWorkerFailure(input: {
  supabase: SupabaseClient;
  jobId: string;
  workerId: string;
  error: unknown;
}): Promise<DocumentJob | null> {
  const failure = mapWorkerFailure(input.error);
  const { data, error } = await input.supabase.rpc(
    "finalize_document_v2_worker_failure",
    {
      target_job_id: input.jobId,
      expected_worker_id: input.workerId,
      failure_code: failure.code.slice(0, 120),
      failure_category: (failure.diagnosticCategory ?? failure.category).slice(0, 120),
      failure_operation: failure.operation.slice(0, 120),
      failure_user_message: documentFailureUserMessage(failure.userMessageCode),
      failure_technical_message: failure.technicalMessage.slice(0, 2_000),
      failed_at: new Date().toISOString(),
    },
  );
  if (error) throw error;
  return data ? DocumentJobSchema.parse(data) : null;
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
  const usageIntegration = new AiUsageIntegration(
    new SupabaseAiUsageEventSink(supabase, {
      feature: "document_v2",
      taskKind: "document_model_call",
    }),
  );
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
    await usageIntegration.record(claimedJob.ownerId, {
      usageEventId: randomUUID(),
      billingOperationId: claimedJob.jobId,
      operation: assertRegisteredAiOperation(usage.operation),
      provider: usage.provider,
      modelId: usage.actualModelId,
      attemptNumber: usage.attemptNumber,
      cacheHit: false,
      usage: [tokenUsage(usage)],
      occurredAt: new Date().toISOString(),
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
  const researchPreparation = job.checkpoint.orchestration
    ? { outcome: "ready" as const, job }
    : await prepareOptionalDocumentResearch({ job, repository, supabase });
  if (researchPreparation.outcome === "waiting") {
    return {
      state: researchPreparation.job.status,
      jobId: researchPreparation.job.jobId,
      stage: researchPreparation.job.stage,
      progress: researchPreparation.job.progress,
    };
  }
  let preparedJob = researchPreparation.job.checkpoint.orchestration
    ? researchPreparation.job
    : await prepareIntake({
        job: researchPreparation.job,
        repository,
        textExecutor,
        researchExplorationAdvisory: researchPreparation.hints,
      });
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
  if (!preparedJob.checkpoint.imageExecution) {
    const savedAt = new Date().toISOString();
    preparedJob = await repository.save(
      DocumentJobSchema.parse({
        ...preparedJob,
        checkpoint: {
          ...preparedJob.checkpoint,
          imageExecution: createImageExecutionProfile({
            visualIntent:
              preparedJob.checkpoint.orchestration.request.userRequirements
                .visualIntent,
            frozenAt: savedAt,
          }),
          savedAt,
        },
        updatedAt: savedAt,
      }),
      preparedJob.revision,
    );
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
  const imageExecution = preparedJob.checkpoint.imageExecution;
  if (!imageExecution) {
    throw new Error("document_image_execution_profile_missing");
  }
  const service = new DocumentV2JobService(
    repository,
    {
      generator: new ModelDocumentComponentGenerator(
        new OpenAIStructuredComponentModel(textExecutor),
      ),
      validator: new MatureDocumentComponentValidator(),
      figureAssetMaterializer: createFigureAssetMaterializer({
        supabase,
        ownerId: preparedJob.ownerId,
        jobId: preparedJob.jobId,
        imageExecution,
        openAiApiKey: config.openAiApiKey,
      }),
      maxAttemptsPerComponent: 2,
      maxProviderCallsPerComponent: 3,
    },
    createDocumentFinalizer({
      supabase,
      ownerId: claimedJob.ownerId,
    }),
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
