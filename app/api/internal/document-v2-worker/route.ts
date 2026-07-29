import { timingSafeEqual } from "node:crypto";
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
  try {
    const result = await executeOneDocumentV2Tick();
    if (result.state === "queued") {
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
    console.error("[document-v2-worker] Tick failed", error);
    return Response.json({ error: "Worker tick failed." }, { status: 500 });
  }
}
