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
