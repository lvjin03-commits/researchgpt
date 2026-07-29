import { randomUUID, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { executeOneDocumentV2Tick } from "@/lib/document-v2-production/worker";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !supplied) return false;
  const left = Buffer.from(secret);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
        const secret = process.env.CRON_SECRET;
        if (!secret) return;
        try {
          await fetch(request.url, {
            headers: { Authorization: `Bearer ${secret}` },
            cache: "no-store",
          });
        } catch (error) {
          console.error("[document-v2-worker] Continuation dispatch failed", error);
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
