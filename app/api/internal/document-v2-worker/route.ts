import { timingSafeEqual } from "node:crypto";
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
    return Response.json(await executeOneDocumentV2Tick(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[document-v2-worker] Tick failed", error);
    return Response.json({ error: "Worker tick failed." }, { status: 500 });
  }
}
