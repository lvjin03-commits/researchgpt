import { randomUUID } from "node:crypto";
import type { RunDocumentOrchestrationOptions } from "../orchestration/orchestrator";
import {
  createDocumentOrchestrationState,
  runDocumentOrchestration,
} from "../orchestration/orchestrator";
import type {
  DocumentPlan,
  DocumentRequest,
  FinalDocumentSpec,
  VerifiedReference,
} from "../contracts";
import {
  DocumentJobSchema,
  STAGE_LABELS,
  type DocumentJob,
  type DocumentJobEvent,
  type DocumentJobSnapshot,
  type DocumentJobStage,
  type DocumentTextExecutionProfile,
} from "./contracts";
import type { DocumentJobRepository } from "./repository";
import {
  getDocumentJobSnapshot,
  requestDocumentJobCancellation,
  resumeDocumentJob,
  DocumentJobNotFoundError,
} from "./controls";

export interface FinalDocumentArtifact {
  artifactId: string;
}

export interface DocumentFinalizer {
  renderAndStore(input: {
    jobId: string;
    spec: FinalDocumentSpec;
    onStage(stage: Extract<
      DocumentJobStage,
      "docx_rendering" | "quality_check" | "artifact_storage"
    >): Promise<void>;
    shouldCancel(): Promise<boolean>;
  }): Promise<FinalDocumentArtifact>;
}

type Clock = () => Date;

export { DocumentJobNotFoundError };
export class DocumentJobLeaseUnavailableError extends Error {}

function completedCount(job: DocumentJob): number {
  return (job.checkpoint.orchestration?.components ?? []).filter(
    (component) => component.status === "approved",
  ).length;
}

function progressFor(job: DocumentJob, stage = job.stage): number {
  if (stage === "completed") return 100;
  const contentRatio =
    completedCount(job) / Math.max(1, job.totalComponents);
  const figures = job.checkpoint.orchestration?.figures ?? [];
  const assetRatio =
    figures.length === 0
      ? 1
      : figures.filter((figure) => figure.status === "approved").length /
        figures.length;
  if (stage === "content_generation") {
    return Math.min(70, Math.round(8 + contentRatio * 62));
  }
  if (stage === "asset_generation") {
    return Math.min(85, Math.round(70 + assetRatio * 15));
  }
  const stageBonus: Partial<Record<DocumentJobStage, number>> = {
    queued: 0,
    template_resolution: 3,
    planning: 8,
    document_assembly: 85,
    docx_rendering: 90,
    quality_check: 95,
    artifact_storage: 98,
  };
  return Math.min(99, stageBonus[stage] ?? 10);
}

function userErrorMessage(code: string): string {
  if (code.includes("timeout")) {
    return "模型响应超时，系统已完成技术重试，请稍后从保存进度继续。";
  }
  if (code.includes("unavailable")) {
    return "模型服务暂时不可用，当前进度已保存，请稍后继续。";
  }
  if (code.includes("figure_asset")) return "图片生成未通过质量检查。";
  if (code.includes("validation") || code.includes("structure")) {
    return "当前部分的内容未通过质量检查。";
  }
  if (code.includes("render")) return "Word 文档排版失败。";
  return "文档生成在当前阶段停止，请查看详情后重试。";
}

export class DocumentV2JobService {
  constructor(
    private readonly repository: DocumentJobRepository,
    private readonly orchestrationOptions: RunDocumentOrchestrationOptions,
    private readonly finalizer: DocumentFinalizer,
    private readonly clock: Clock = () => new Date(),
  ) {}

  async createIntake(input: {
    ownerId: string;
    jobId: string;
    instruction: string;
    source: DocumentRequest["source"];
    language?: "zh" | "en";
    targetLength?: number;
    verifiedReferences?: VerifiedReference[];
    evidence?: Array<{
      evidenceId: string;
      reference: VerifiedReference;
      excerpt: string;
      locator?: { page?: number; section?: string };
    }>;
    textExecution: DocumentTextExecutionProfile;
  }): Promise<DocumentJobSnapshot> {
    const now = this.clock().toISOString();
    const job = DocumentJobSchema.parse({
      jobId: input.jobId,
      ownerId: input.ownerId,
      pipelineVersion: "document-v2",
      status: "queued",
      stage: "intake",
      progress: 0,
      completedComponents: 0,
      totalComponents: 0,
      resumable: true,
      checkpoint: {
        schemaVersion: 1,
        textExecution: input.textExecution,
        dispatchToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
        intake: {
          instruction: input.instruction,
          source: input.source,
          language: input.language,
          targetLength: input.targetLength,
          verifiedReferences: input.verifiedReferences ?? [],
          evidence: input.evidence ?? [],
        },
        savedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      revision: 0,
    });
    await this.repository.create(job);
    await this.event(job, "intake", "progress", "任务已创建，正在准备执行。");
    return this.snapshot(job.jobId);
  }

  async create(input: {
    ownerId: string;
    request: DocumentRequest;
    plan: DocumentPlan;
    verifiedReferences?: VerifiedReference[];
  }): Promise<DocumentJobSnapshot> {
    const now = this.clock().toISOString();
    const jobId = input.request.requestId;
    const orchestration = createDocumentOrchestrationState({
      jobId,
      request: input.request,
      plan: input.plan,
      verifiedReferences: input.verifiedReferences,
    });
    const job = DocumentJobSchema.parse({
      jobId,
      ownerId: input.ownerId,
      pipelineVersion: "document-v2",
      status: "queued",
      stage: "queued",
      progress: 0,
      completedComponents: 0,
      totalComponents: orchestration.components.length,
      resumable: true,
      checkpoint: {
        schemaVersion: 1,
        orchestration,
        savedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      revision: 0,
    });
    await this.repository.create(job);
    await this.event(job, "queued", "progress", "任务已创建，等待开始。");
    return this.snapshot(jobId);
  }

  async snapshot(jobId: string): Promise<DocumentJobSnapshot> {
    return getDocumentJobSnapshot(this.repository, jobId);
  }

  async requestCancel(jobId: string): Promise<DocumentJobSnapshot> {
    return requestDocumentJobCancellation(
      this.repository,
      jobId,
      this.clock,
    );
  }

  async resume(jobId: string): Promise<DocumentJobSnapshot> {
    return resumeDocumentJob(this.repository, jobId, this.clock);
  }

  async run(
    jobId: string,
    workerId: string,
    options: { maxComponents?: number; maxDurationMs?: number } = {},
  ): Promise<DocumentJobSnapshot> {
    const runStartedAt = this.clock().getTime();
    const maxDurationMs = options.maxDurationMs ?? Number.POSITIVE_INFINITY;
    const leasedJob = await this.repository.acquireLease({
      jobId,
      workerId,
      now: this.clock(),
      leaseMs:
        maxDurationMs === Number.POSITIVE_INFINITY
          ? 5 * 60_000
          : Math.max(60_000, maxDurationMs + 30_000),
    });
    if (!leasedJob) throw new DocumentJobLeaseUnavailableError();
    let job: DocumentJob = leasedJob;
    if (!job.checkpoint.orchestration) {
      throw new Error("Document intake must be prepared before content execution.");
    }
    if (["completed", "cancelled"].includes(job.status)) {
      return this.snapshot(jobId);
    }
    if (job.cancelRequestedAt) return this.cancel(job);

    const now = this.clock().toISOString();
    job = await this.repository.save(
      {
        ...job,
        status: "running",
        stage: "content_generation",
        startedAt: job.startedAt ?? now,
        updatedAt: now,
      },
      job.revision,
    );

    const maxComponents = options.maxComponents ?? Number.POSITIVE_INFINITY;
    let processedComponents = 0;
    while (job.checkpoint.orchestration?.status !== "completed") {
      if (await this.cancelRequested(job.jobId)) return this.cancel(job);
      const budget = job.checkpoint.budget;
      const orchestrationForBudget = job.checkpoint.orchestration;
      const imageBudgetExhausted = Boolean(
        budget &&
          orchestrationForBudget &&
          orchestrationForBudget.components.every(
            (component) => component.status === "approved",
          ) &&
          orchestrationForBudget.figures.some(
            (figure) => figure.status !== "approved",
          ) &&
          budget.usedImageCalls >= budget.maxImageCalls,
      );
      if (
        budget &&
        (budget.usedModelCalls >= budget.maxModelCalls ||
          imageBudgetExhausted ||
          budget.usedRepairAttempts >= budget.maxRepairAttempts ||
          budget.usedExecutionMs >= budget.maxExecutionMs)
      ) {
        const exhaustedAt = this.clock().toISOString();
        job = await this.repository.save(
          DocumentJobSchema.parse({
            ...job,
            status: "budget_exhausted",
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            updatedAt: exhaustedAt,
          }),
          job.revision,
        );
        await this.event(
          job,
          job.stage,
          "paused",
          "任务已达到生成预算，已保存当前进度。",
          job.currentComponentKey,
          undefined,
          "job_budget_exhausted",
        );
        return this.snapshot(jobId);
      }
      const orchestrationState = job.checkpoint.orchestration;
      if (!orchestrationState) {
        throw new Error("Document orchestration checkpoint disappeared.");
      }
      const before = orchestrationState.currentComponentIndex;
      const component =
        orchestrationState.plan.components[before];
      const contentPending = orchestrationState.components.some(
        (item) => item.status !== "approved",
      );
      const activeStage: DocumentJobStage = contentPending
        ? "content_generation"
        : "asset_generation";
      const pendingFigure = contentPending
        ? undefined
        : orchestrationState.figures.find(
            (figure) =>
              figure.status !== "approved" && figure.status !== "failed",
          );
      const activeComponentKey =
        pendingFigure?.request.componentKey ?? component?.componentKey;
      const activePurpose =
        pendingFigure?.request.title ??
        component?.purpose ??
        "组装已批准的文档内容";
      if (job.stage !== activeStage) {
        job = await this.changeStage(job, activeStage);
      }
      await this.event(
        job,
        activeStage,
        "started",
        activeStage === "asset_generation"
          ? `正在生成图片：${activePurpose}`
          : `正在生成：${activePurpose}`,
        activeComponentKey,
      );
      const started = this.clock().getTime();
      const attemptsBefore = orchestrationState.components.reduce(
        (sum, item) => sum + item.attempts,
        0,
      );
      const transientFailuresBefore = orchestrationState.components.reduce(
        (sum, item) => sum + item.transientFailures,
        0,
      );
      const repairsBefore = orchestrationState.components.reduce(
        (sum, item) => sum + Math.max(0, item.attempts - 1),
        0,
      );
      let imageCallsUsed = 0;
      const orchestration = await runDocumentOrchestration(
        orchestrationState,
        {
          ...this.orchestrationOptions,
          maxComponentsPerRun: 1,
          maxFigureAssetsPerDocument:
            budget?.maxImageAssets ?? Number.POSITIVE_INFINITY,
          onFigureProviderCall: () => {
            imageCallsUsed += 1;
          },
        },
      );
      const current = component
        ? orchestration.components[before]
        : undefined;
      const attemptsAfter = orchestration.components.reduce(
        (sum, item) => sum + item.attempts,
        0,
      );
      const transientFailuresAfter = orchestration.components.reduce(
        (sum, item) => sum + item.transientFailures,
        0,
      );
      const repairsAfter = orchestration.components.reduce(
        (sum, item) => sum + Math.max(0, item.attempts - 1),
        0,
      );
      const modelCallsUsed = Math.max(
        0,
        attemptsAfter -
          attemptsBefore +
          transientFailuresAfter -
          transientFailuresBefore,
      );
      const repairsUsed = Math.max(0, repairsAfter - repairsBefore);
      const completedImageAssets = orchestration.figures.filter(
        (figure) => figure.status === "approved",
      ).length;
      const savedAt = this.clock().toISOString();
      job = await this.repository.save(
        DocumentJobSchema.parse({
          ...job,
          status:
            orchestration.status === "failed" ? "failed" : "running",
          stage: activeStage,
          progress: progressFor(
            {
              ...job,
              checkpoint: { ...job.checkpoint, orchestration },
            },
            activeStage,
          ),
          currentComponentKey: activeComponentKey,
          completedComponents: orchestration.components.filter(
            (item) => item.status === "approved",
          ).length,
          checkpoint: {
            ...job.checkpoint,
            orchestration,
            budget: job.checkpoint.budget
              ? {
                  ...job.checkpoint.budget,
                  usedModelCalls:
                    job.checkpoint.budget.usedModelCalls + modelCallsUsed,
                  usedImageCalls:
                    job.checkpoint.budget.usedImageCalls + imageCallsUsed,
                  completedImageAssets,
                  usedRepairAttempts:
                    job.checkpoint.budget.usedRepairAttempts + repairsUsed,
                  usedExecutionMs:
                    job.checkpoint.budget.usedExecutionMs +
                    (this.clock().getTime() - started),
                }
              : undefined,
            savedAt,
          },
          error:
            orchestration.status === "failed"
              ? {
                  code: orchestration.failure!.code,
                  userMessage: userErrorMessage(orchestration.failure!.code),
                  technicalMessage: orchestration.failure!.message,
                  failedStage: activeStage,
                  componentKey: orchestration.failure!.componentKey,
                }
              : undefined,
          finishedAt:
            orchestration.status === "failed" ? savedAt : undefined,
          updatedAt: savedAt,
        }),
        job.revision,
      );
      if (orchestration.status === "failed") {
        await this.event(
          job,
          activeStage,
          "failed",
          job.error!.userMessage,
          activeComponentKey,
          current?.attempts || pendingFigure?.attempts || undefined,
          job.error!.code,
          job.error!.technicalMessage,
        );
        return this.snapshot(jobId);
      }
      await this.event(
        job,
        activeStage,
        "succeeded",
        activeStage === "asset_generation"
          ? `图片已保存：${activePurpose}`
          : `已完成：${activePurpose}`,
        activeComponentKey,
        current?.attempts || pendingFigure?.attempts || undefined,
        undefined,
        undefined,
        this.clock().getTime() - started,
      );
      processedComponents += 1;
      if (
        (processedComponents >= maxComponents ||
          this.clock().getTime() - runStartedAt >= maxDurationMs) &&
        orchestration.status !== "completed"
      ) {
        const queuedAt = this.clock().toISOString();
        job = await this.repository.save(
          DocumentJobSchema.parse({
            ...job,
            status: "queued",
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            updatedAt: queuedAt,
          }),
          job.revision,
        );
        await this.event(
          job,
          activeStage,
          "progress",
          activeStage === "asset_generation"
            ? "本轮图片已保存，任务将在下一轮生成下一张图片。"
            : "本轮内容已保存，任务将在下一轮从下一个文档部分继续。",
        );
        return this.snapshot(jobId);
      }
    }

    job = await this.changeStage(job, "document_assembly");
    const spec = job.checkpoint.orchestration?.finalSpec;
    if (!spec) throw new Error("Completed orchestration has no final document spec.");
    let artifact: FinalDocumentArtifact;
    try {
      artifact = await this.finalizer.renderAndStore({
        jobId,
        spec,
        onStage: async (stage) => {
          job = await this.changeStage(job, stage);
        },
        shouldCancel: () => this.cancelRequested(jobId),
      });
    } catch (error) {
      const failedAt = this.clock().toISOString();
      const technicalMessage =
        error instanceof Error ? error.message : String(error);
      job = await this.repository.save(
        DocumentJobSchema.parse({
          ...job,
          status: "failed",
          resumable: true,
          error: {
            code: "document_finalization_failed",
            userMessage: userErrorMessage("render"),
            technicalMessage,
            failedStage: job.stage,
          },
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: failedAt,
          finishedAt: failedAt,
        }),
        job.revision,
      );
      await this.event(
        job,
        job.stage,
        "failed",
        job.error!.userMessage,
        undefined,
        undefined,
        job.error!.code,
        technicalMessage,
      );
      return this.snapshot(jobId);
    }
    if (await this.cancelRequested(jobId)) return this.cancel(job);
    const finishedAt = this.clock().toISOString();
    job = await this.repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "completed",
        stage: "completed",
        progress: 100,
        artifactId: artifact.artifactId,
        currentComponentKey: undefined,
        resumable: false,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        checkpoint: {
          ...job.checkpoint,
          renderedArtifactId: artifact.artifactId,
          savedAt: finishedAt,
        },
        updatedAt: finishedAt,
        finishedAt,
      }),
      job.revision,
    );
    await this.event(job, "completed", "succeeded", "文件已生成，可以下载。");
    return this.snapshot(jobId);
  }

  private async changeStage(
    job: DocumentJob,
    stage: DocumentJobStage,
  ): Promise<DocumentJob> {
    const now = this.clock().toISOString();
    const saved = await this.repository.save(
      {
        ...job,
        stage,
        progress: progressFor(job, stage),
        updatedAt: now,
      },
      job.revision,
    );
    await this.event(saved, stage, "started", STAGE_LABELS[stage]);
    return saved;
  }

  private async cancel(job: DocumentJob): Promise<DocumentJobSnapshot> {
    const latest = (await this.repository.get(job.jobId)) ?? job;
    const now = this.clock().toISOString();
    const cancelled = await this.repository.save(
      DocumentJobSchema.parse({
        ...latest,
        status: "cancelled",
        resumable: true,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        updatedAt: now,
        finishedAt: now,
      }),
      latest.revision,
    );
    await this.event(
      cancelled,
      cancelled.stage,
      "cancelled",
      "任务已停止，已完成的内容已经保存。",
    );
    return this.snapshot(job.jobId);
  }

  private async cancelRequested(jobId: string): Promise<boolean> {
    return Boolean((await this.repository.get(jobId))?.cancelRequestedAt);
  }

  private async requireJob(jobId: string): Promise<DocumentJob> {
    const job = await this.repository.get(jobId);
    if (!job) throw new DocumentJobNotFoundError();
    return job;
  }

  private async event(
    job: DocumentJob,
    stage: DocumentJobStage,
    status: DocumentJobEvent["status"],
    message: string,
    componentKey?: string,
    attempt?: number,
    errorCode?: string,
    technicalMessage?: string,
    durationMs?: number,
  ): Promise<void> {
    const orchestration = job.checkpoint.orchestration;
    const componentPlan = componentKey
      ? orchestration?.plan.components.find(
          (component) => component.componentKey === componentKey,
        )
      : undefined;
    const componentState = componentKey
      ? orchestration?.components.find(
          (component) => component.componentKey === componentKey,
        )
      : undefined;
    const assetCount =
      componentState?.approved?.kind === "blocks"
        ? componentState.approved.assets.length
        : 0;
    const category: NonNullable<DocumentJobEvent["category"]> =
      stage === "content_generation"
        ? status === "started"
          ? "model"
          : "validation"
        : stage === "asset_generation"
          ? "image"
          : stage === "docx_rendering" || stage === "quality_check"
            ? "render"
            : stage === "artifact_storage"
              ? "storage"
              : "lifecycle";
    await this.repository.appendEvent({
      eventId: randomUUID(),
      jobId: job.jobId,
      stage,
      status,
      message,
      category,
      operation: componentKey
        ? `component.${status}`
        : `stage.${stage}.${status}`,
      correlationId: componentKey
        ? `${job.jobId}:${componentKey}`
        : job.jobId,
      metadata: {
        jobRevision: job.revision,
        ...(attempt === undefined ? {} : { attempt }),
        ...(componentPlan ? { componentType: componentPlan.type } : {}),
        ...(componentState
          ? { componentStatus: componentState.status, assetCount }
          : {}),
        ...(errorCode === undefined ? {} : { errorCode }),
        ...(job.checkpoint.budget
          ? {
              usedModelCalls: job.checkpoint.budget.usedModelCalls,
              usedImageCalls: job.checkpoint.budget.usedImageCalls,
              completedImageAssets:
                job.checkpoint.budget.completedImageAssets,
              usedRepairAttempts:
                job.checkpoint.budget.usedRepairAttempts,
              usedExecutionMs: job.checkpoint.budget.usedExecutionMs,
            }
          : {}),
        ...(job.checkpoint.executionSnapshot?.modelId
          ? { modelId: job.checkpoint.executionSnapshot.modelId }
          : {}),
        ...(job.checkpoint.executionSnapshot?.generatorPromptVersion
          ? {
              promptVersion:
                job.checkpoint.executionSnapshot.generatorPromptVersion,
            }
          : {}),
        ...(job.checkpoint.intake?.source.kind
          ? { sourceKind: job.checkpoint.intake.source.kind }
          : {}),
      },
      componentKey,
      attempt,
      errorCode,
      technicalMessage,
      durationMs,
      createdAt: this.clock().toISOString(),
    });
  }
}
