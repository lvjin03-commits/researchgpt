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
  const startedAt = Date.now();
  console.info("[document-v2-worker]", {
    invocationId,
    operation: "worker.tick.started",
  });
  try {
    const result = await executeOneDocumentV2Tick();
    console.info("[document-v2-worker]", {
      invocationId,
      operation: "worker.tick.finished",
      durationMs: Date.now() - startedAt,
      ...result,
    });
    if (result.state !== "idle") {
      after(async () => {
        try {
          await dispatchDocumentV2Worker({
            cause: "continuation",
            requestUrl: request.url,
            jobId: "jobId" in result ? result.jobId : undefined,
          });
        } catch (error) {
          logDocumentV2DispatchFailure({
            operation: "worker.continuation_dispatch.failed",
            cause: "continuation",
            jobId: "jobId" in result ? result.jobId : undefined,
            error,
          });
        }
      });
    }
    return Response.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[document-v2-worker]", {
      invocationId,
      operation: "worker.tick.failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return Response.json({ error: "Worker tick failed." }, { status: 500 });
  }
}

export const GET = handleWorker;
export const POST = handleWorker;
