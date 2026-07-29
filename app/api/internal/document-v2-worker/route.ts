import { randomUUID, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { executeOneDocumentV2Tick } from "@/lib/document-v2-production/worker";
import {
  dispatchDocumentV2Worker,
  logDocumentV2DispatchFailure,
} from "@/lib/document-v2-production/dispatch";
import {
  DocumentV2ConfigurationError,
  requireDocumentV2WorkerConfig,
} from "@/lib/document-v2-production/runtime-config";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(expected: string, request: Request): boolean {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function handleWorker(request: Request) {
  let config;
  try {
    config = requireDocumentV2WorkerConfig();
  } catch (error) {
    if (!(error instanceof DocumentV2ConfigurationError)) throw error;
    console.error("[document-v2-worker]", {
      operation: "worker.configuration.invalid",
      missing: error.missing,
      invalid: error.invalid,
    });
    return Response.json(
      {
        error: "Document worker is unavailable.",
        code: error.code,
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "60",
        },
      },
    );
  }
  if (!authorized(config.cronSecret, request)) {
    console.warn("[document-v2-worker]", {
      operation: "worker.authorization.rejected",
    });
    return Response.json(
      {
        error: "Unauthorized",
        code: "document_v2_worker_unauthorized",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const invocationId = randomUUID();
  let requestedJobId: string | undefined;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as { jobId?: unknown };
      requestedJobId =
        typeof body.jobId === "string" && body.jobId.length > 0
          ? body.jobId
          : undefined;
    } catch {
      return Response.json(
        { error: "Invalid worker request.", code: "invalid_worker_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  console.info("[document-v2-worker]", {
    invocationId,
    operation: "worker.tick.accepted",
    jobId: requestedJobId,
  });
  after(async () => {
    const startedAt = Date.now();
    try {
      const result = await executeOneDocumentV2Tick(requestedJobId);
      console.info("[document-v2-worker]", {
        invocationId,
        operation: "worker.tick.finished",
        durationMs: Date.now() - startedAt,
        requestedJobId,
        ...result,
      });
      if (result.state === "queued") {
        try {
          await dispatchDocumentV2Worker({
            cause: "continuation",
            requestUrl: request.url,
            jobId: result.jobId,
          });
        } catch (error) {
          logDocumentV2DispatchFailure({
            operation: "worker.continuation_dispatch.failed",
            cause: "continuation",
            jobId: result.jobId,
            error,
          });
        }
      }
    } catch (error) {
      console.error("[document-v2-worker]", {
        invocationId,
        operation: "worker.tick.failed",
        durationMs: Date.now() - startedAt,
        requestedJobId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  });
  return Response.json(
    { state: "accepted", invocationId, jobId: requestedJobId ?? null },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = handleWorker;
export const POST = handleWorker;
