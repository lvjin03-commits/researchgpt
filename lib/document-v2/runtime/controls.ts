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
) {
  await repository.appendEvent({
    eventId: randomUUID(),
    jobId,
    stage,
    status: "progress",
    message,
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
  const orchestration = structuredClone(job.checkpoint.orchestration);
  if (orchestration.status === "failed") {
    const failedIndex = orchestration.components.findIndex(
      (component) => component.status === "failed",
    );
    if (failedIndex >= 0) {
      orchestration.status = "paused";
      orchestration.failure = undefined;
      orchestration.currentComponentIndex = failedIndex;
      orchestration.components[failedIndex] = {
        componentKey: orchestration.components[failedIndex].componentKey,
        status: "pending",
        attempts: 0,
      };
    }
  }
  const now = clock().toISOString();
  job = await repository.save(
    DocumentJobSchema.parse({
      ...job,
      status: "paused",
      stage: "content_generation",
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
    "已从上次保存的位置恢复。",
  );
  return getDocumentJobSnapshot(repository, jobId);
}
