import { randomUUID, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { executeOneDocumentV2Tick } from "@/lib/document-v2-production/worker";
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

function secureEqual(expected: string, supplied: string): boolean {
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
  let requestedJobId: string | undefined;
  let dispatchToken: string | undefined;
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as {
        jobId?: unknown;
        dispatchToken?: unknown;
      };
      requestedJobId =
        typeof body.jobId === "string" && body.jobId.length > 0
          ? body.jobId
          : undefined;
      dispatchToken =
        typeof body.dispatchToken === "string" ? body.dispatchToken : undefined;
    } catch {
      return Response.json(
        { error: "Invalid worker request.", code: "invalid_worker_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  const cronAuthorized = authorized(config.cronSecret, request);
  let jobTokenAuthorized = false;
  if (!cronAuthorized && requestedJobId && dispatchToken) {
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase
      .from("document_v2_jobs")
      .select("job_payload")
      .eq("id", requestedJobId)
      .maybeSingle();
    const storedToken = (
      data?.job_payload as {
        checkpoint?: { dispatchToken?: unknown };
      } | null
    )?.checkpoint?.dispatchToken;
    jobTokenAuthorized =
      typeof storedToken === "string" &&
      secureEqual(storedToken, dispatchToken);
  }
  if (!cronAuthorized && !jobTokenAuthorized) {
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
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : typeof error === "object" && error !== null
            ? { message: JSON.stringify(error), stack: undefined }
            : { message: String(error), stack: undefined };
      console.error("[document-v2-worker]", {
        invocationId,
        operation: "worker.tick.failed",
        durationMs: Date.now() - startedAt,
        requestedJobId,
        error: normalizedError.message,
        stack: normalizedError.stack,
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
