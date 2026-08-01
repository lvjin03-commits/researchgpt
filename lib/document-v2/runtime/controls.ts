import { randomUUID } from "node:crypto";
import { DocumentJobSchema, publicJobSnapshot } from "./contracts";
import type { DocumentJobRepository } from "./repository";

type Clock = () => Date;

export class DocumentJobNotFoundError extends Error {}

async function requireJob(
  repository: DocumentJobRepository,
  jobId: string,
) {
  const job = await repository.get(jobId);
  if (!job) throw new DocumentJobNotFoundError();
  return job;
}

async function controlEvent(
  repository: DocumentJobRepository,
  jobId: string,
  stage: Parameters<DocumentJobRepository["appendEvent"]>[0]["stage"],
  message: string,
  metadata?: Parameters<DocumentJobRepository["appendEvent"]>[0]["metadata"],
) {
  await repository.appendEvent({
    eventId: randomUUID(),
    jobId,
    stage,
    status: "progress",
    message,
    category: "recovery",
    operation: "recovery.resume_point.resolved",
    metadata,
    createdAt: new Date().toISOString(),
  });
}

export async function getDocumentJobSnapshot(
  repository: DocumentJobRepository,
  jobId: string,
) {
  const job = await requireJob(repository, jobId);
  return publicJobSnapshot(job, await repository.listEvents(jobId));
}

export async function requestDocumentJobCancellation(
  repository: DocumentJobRepository,
  jobId: string,
  clock: Clock = () => new Date(),
) {
  let job = await requireJob(repository, jobId);
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return getDocumentJobSnapshot(repository, jobId);
  }
  const now = clock().toISOString();
  job = await repository.save(
    {
      ...job,
      status: "cancelling",
      cancelRequestedAt: now,
      updatedAt: now,
    },
    job.revision,
  );
  await controlEvent(repository, jobId, job.stage, "正在安全停止任务。");
  return getDocumentJobSnapshot(repository, jobId);
}

export async function resumeDocumentJob(
  repository: DocumentJobRepository,
  jobId: string,
  clock: Clock = () => new Date(),
) {
  let job = await requireJob(repository, jobId);
  if (!["paused", "failed", "cancelled"].includes(job.status)) {
    return getDocumentJobSnapshot(repository, jobId);
  }
  const orchestration = job.checkpoint.orchestration
    ? structuredClone(job.checkpoint.orchestration)
    : undefined;
  if (!orchestration) {
    const now = clock().toISOString();
    const shouldRevisePlanning =
      job.stage === "planning" &&
      job.error?.code === "document_model_split_required" &&
      job.checkpoint.planning !== undefined &&
      job.checkpoint.planning.skeleton === undefined;
    const planning = shouldRevisePlanning
      ? {
          ...job.checkpoint.planning,
          planningRevision:
            (job.checkpoint.planning?.planningRevision ?? 1) + 1,
          thesis: undefined,
          planningMigration: {
            supersededOperation: "outline.structure" as const,
            replacementOperations: [
              "outline.thesis",
              "outline.section_index",
            ] as const,
            reason: "structured_output_capacity_exhausted",
            migratedAt: now,
          },
        }
      : job.checkpoint.planning;
    job = await repository.save(
      DocumentJobSchema.parse({
        ...job,
        status: "queued",
        error: undefined,
        cancelRequestedAt: undefined,
        finishedAt: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        checkpoint: { ...job.checkpoint, planning, savedAt: now },
        updatedAt: now,
      }),
      job.revision,
    );
    await controlEvent(
      repository,
      jobId,
      job.stage,
      shouldRevisePlanning
        ? "已从保存点创建新的规划修订，请求、模板和证据上下文均已保留。"
        : "任务已恢复并重新排队。",
      shouldRevisePlanning
        ? {
            resumeScope: "planning_revision",
            supersededOperation: "outline.structure",
            replacementOperations: "outline.thesis,outline.section_index",
          }
        : undefined,
    );
    return getDocumentJobSnapshot(repository, jobId);
  }
  let resumeStage = job.stage;
  let resumeScope = "saved_stage";
  let validationCode = job.error?.code;
  if (orchestration.status === "failed") {
    const failedIndex = orchestration.components.findIndex(
      (component) => component.status === "failed",
    );
    if (failedIndex >= 0) {
      const failedComponent = orchestration.components[failedIndex];
      validationCode = failedComponent.lastError?.code ?? validationCode;
      orchestration.status = "paused";
      orchestration.failure = undefined;
      orchestration.currentComponentIndex = failedIndex;
      orchestration.components[failedIndex] = {
        componentKey: failedComponent.componentKey,
        status: "pending",
        generationRevision: failedComponent.generationRevision + 1,
        attempts: 0,
        transientFailures: 0,
        lastError: failedComponent.lastError,
        revisions: failedComponent.revisions,
      };
      resumeStage = "content_generation";
      resumeScope = "component_revision";
    } else {
      const failedFigureIndex = orchestration.figures.findIndex(
        (figure) => figure.status === "failed",
      );
      if (failedFigureIndex >= 0) {
        const failedFigure = orchestration.figures[failedFigureIndex];
        validationCode = failedFigure.lastError?.code ?? validationCode;
        orchestration.status = "paused";
        orchestration.failure = undefined;
        orchestration.figures[failedFigureIndex] = {
          ...failedFigure,
          status: "pending",
          attempts: 0,
          lastError: failedFigure.lastError,
        };
        resumeStage = "asset_generation";
        resumeScope = "figure_retry";
      }
    }
  }
  const now = clock().toISOString();
  job = await repository.save(
    DocumentJobSchema.parse({
      ...job,
      status: "queued",
      stage: resumeStage,
      error: undefined,
      cancelRequestedAt: undefined,
      finishedAt: undefined,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      checkpoint: { ...job.checkpoint, orchestration, savedAt: now },
      updatedAt: now,
    }),
    job.revision,
  );
  await controlEvent(
    repository,
    jobId,
    job.stage,
    resumeScope === "component_revision"
      ? "已创建失败内容的新修订，仅重新处理该内容。"
      : resumeScope === "figure_retry"
        ? "已从失败图片恢复，不会重新生成正文。"
        : "已从上次保存的阶段恢复。",
    {
      resumeScope,
      validationCode: validationCode ?? null,
    },
  );
  return getDocumentJobSnapshot(repository, jobId);
}
