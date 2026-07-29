import { randomUUID } from "node:crypto";
import type { DocumentJobRepository } from "@/lib/document-v2/runtime/repository";
import { requireDocumentV2WorkerConfig } from "./runtime-config";

export type DocumentV2DispatchCause =
  | "job_created"
  | "continuation"
  | "resume"
  | "clarification"
  | "recovery";

export class DocumentV2DispatchError extends Error {
  readonly code = "document_v2_dispatch_failed";

  constructor(
    readonly status: number | null,
    readonly responseBody: string,
  ) {
    super(
      status === null
        ? "Document worker request failed before receiving a response."
        : `Document worker returned HTTP ${status}.`,
    );
    this.name = "DocumentV2DispatchError";
  }
}

function resolveWorkerUrl(requestUrl: string | URL): URL {
  const configuredOrigin = process.env.DOCUMENT_V2_WORKER_ORIGIN?.trim();
  if (configuredOrigin) {
    return new URL("/api/internal/document-v2-worker", configuredOrigin);
  }
  return new URL("/api/internal/document-v2-worker", requestUrl);
}

export async function dispatchDocumentV2Worker(input: {
  cause: DocumentV2DispatchCause;
  requestUrl: string | URL;
  jobId?: string;
}): Promise<unknown> {
  const config = requireDocumentV2WorkerConfig();
  const workerUrl = resolveWorkerUrl(input.requestUrl);
  let response: Response;

  try {
    response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.cronSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cause: input.cause,
        jobId: input.jobId,
      }),
      cache: "no-store",
      redirect: "error",
    });
  } catch (error) {
    throw new DocumentV2DispatchError(
      null,
      error instanceof Error ? error.message : String(error),
    );
  }

  const responseBody = (await response.text()).slice(0, 1_000);
  if (!response.ok) {
    throw new DocumentV2DispatchError(response.status, responseBody);
  }
  if (!responseBody) return null;

  try {
    return JSON.parse(responseBody);
  } catch {
    return responseBody;
  }
}

export function logDocumentV2DispatchFailure(input: {
  cause: DocumentV2DispatchCause;
  error: unknown;
  jobId?: string;
  operation?: string;
}) {
  const status =
    input.error instanceof DocumentV2DispatchError
      ? input.error.status
      : null;
  console.error("[document-v2-dispatch]", {
    operation: input.operation ?? "dispatch.failed",
    cause: input.cause,
    jobId: input.jobId,
    httpStatus: status,
    error:
      input.error instanceof Error ? input.error.message : String(input.error),
  });
}

export async function recordDocumentV2DispatchFailure(input: {
  repository: DocumentJobRepository;
  cause: DocumentV2DispatchCause;
  error: unknown;
  jobId: string;
}) {
  try {
    const job = await input.repository.get(input.jobId);
    if (!job) return;
    const status =
      input.error instanceof DocumentV2DispatchError
        ? input.error.status
        : null;
    await input.repository.appendEvent({
      eventId: randomUUID(),
      jobId: input.jobId,
      stage: job.stage,
      status: "retrying",
      message: "后台任务暂时未能启动，系统将通过恢复机制再次尝试。",
      category: "dispatch",
      operation: "dispatch.initial.failed",
      correlationId: input.jobId,
      errorCode: "document_v2_dispatch_failed",
      technicalMessage:
        input.error instanceof Error ? input.error.message : String(input.error),
      metadata: {
        cause: input.cause,
        httpStatus: status,
      },
      createdAt: new Date().toISOString(),
    });
  } catch (recordingError) {
    console.error("[document-v2-dispatch]", {
      operation: "dispatch.failure_event.failed",
      cause: input.cause,
      jobId: input.jobId,
      error:
        recordingError instanceof Error
          ? recordingError.message
          : String(recordingError),
    });
  }
}
