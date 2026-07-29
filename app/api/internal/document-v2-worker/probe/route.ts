import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CHAT_ATTACHMENTS_BUCKET } from "@/lib/uploads/storage-constants";
import {
  DocumentV2ConfigurationError,
  requireDocumentV2WorkerConfig,
} from "@/lib/document-v2-production/runtime-config";

export const runtime = "nodejs";

function secureEqual(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  let config;
  try {
    config = requireDocumentV2WorkerConfig();
  } catch (error) {
    if (!(error instanceof DocumentV2ConfigurationError)) throw error;
    console.error("[document-v2-probe]", {
      operation: "probe.configuration.invalid",
      missing: error.missing,
      invalid: error.invalid,
    });
    return Response.json(
      {
        ready: false,
        code: "document_v2_worker_not_ready",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!secureEqual(config.cronSecret, supplied)) {
    return Response.json(
      { ready: false, code: "document_v2_worker_unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const checks = {
    configuration: "ok",
    database: "error",
    workerRpc: "error",
    storage: "error",
  };

  const { error: databaseError } = await supabase
    .from("document_v2_jobs")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  if (!databaseError) checks.database = "ok";

  const { data: runtimeHealth, error: workerRpcError } = await supabase.rpc(
    "document_v2_runtime_health",
    { checked_at: new Date().toISOString() },
  );
  if (!workerRpcError) checks.workerRpc = "ok";

  const { error: storageError } = await supabase.storage.getBucket(
    CHAT_ATTACHMENTS_BUCKET,
  );
  if (!storageError) checks.storage = "ok";

  const ready = Object.values(checks).every((value) => value === "ok");
  if (!ready) {
    console.error("[document-v2-probe]", {
      operation: "probe.dependencies.failed",
      databaseError: databaseError?.message,
      workerRpcError: workerRpcError?.message,
      storageError: storageError?.message,
    });
  }

  return Response.json(
    {
      ready,
      checks,
      queue: ready ? runtimeHealth : undefined,
      runtimeVersion: "document-v2-worker-v1",
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
