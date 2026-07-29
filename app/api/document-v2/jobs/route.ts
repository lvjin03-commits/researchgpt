import { z } from "zod";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { VerifiedReferenceSchema } from "@/lib/document-v2/contracts";
import { DocumentEvidenceItemSchema } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { DocumentJobConflictError } from "@/lib/document-v2/runtime/repository";
import { getDocumentJobSnapshot } from "@/lib/document-v2/runtime/controls";

export const runtime = "nodejs";
export const maxDuration = 120;

const CreateJobSchema = z
  .object({
    idempotencyKey: z.uuid(),
    instruction: z.string().trim().min(1).max(8_000),
    source: z
      .object({
        kind: z.enum(["prompt", "previous_message", "attachments", "existing_document"]),
        sourceIds: z.array(z.string().trim().min(1).max(120)).max(100),
      })
      .strict()
      .optional(),
    language: z.enum(["zh", "en"]).optional(),
    targetLength: z.number().int().min(100).max(100_000).optional(),
    verifiedReferences: z.array(VerifiedReferenceSchema).max(500).optional(),
    evidence: z.array(DocumentEvidenceItemSchema).max(2_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  if (process.env.DOCUMENT_V2_RUNTIME_ENABLED !== "true") {
    return Response.json({ error: "新的文档生成主线尚未开放。" }, { status: 404 });
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }
  try {
    const input = CreateJobSchema.parse(await request.json());
    const repository = new SupabaseDocumentJobRepository(supabase, user.id);
    const existing = await repository.get(input.idempotencyKey);
    if (existing) {
      const snapshot = await getDocumentJobSnapshot(
        repository,
        input.idempotencyKey,
      );
      return Response.json(snapshot, {
        status: 200,
        headers: {
          "Cache-Control": "no-store, private",
          Location: `/api/document-v2/jobs/${snapshot.job.jobId}`,
        },
      });
    }
    const references = input.verifiedReferences ?? [];
    const service = new DocumentV2JobService(
      repository,
      {
        generator: { async generate() { throw new Error("Creation API does not execute jobs."); } },
        validator: { async validate() { return { accepted: true }; } },
      },
      { async renderAndStore() { throw new Error("Creation API does not finalize jobs."); } },
    );
    let snapshot;
    try {
      snapshot = await service.createIntake({
        ownerId: user.id,
        jobId: input.idempotencyKey,
        instruction: input.instruction,
        source: input.source ?? { kind: "prompt", sourceIds: [] },
        language: input.language,
        targetLength: input.targetLength,
        verifiedReferences: references,
        evidence: input.evidence,
      });
    } catch (creationError) {
      if (!(creationError instanceof DocumentJobConflictError)) throw creationError;
      snapshot = await getDocumentJobSnapshot(
        repository,
        input.idempotencyKey,
      );
    }
    const workerUrl = new URL("/api/internal/document-v2-worker", request.url);
    after(async () => {
      const secret = process.env.CRON_SECRET;
      if (!secret) return;
      try {
        await fetch(workerUrl, {
          headers: { Authorization: `Bearer ${secret}` },
          cache: "no-store",
        });
      } catch (dispatchError) {
        console.error("[document-v2-dispatch] Immediate dispatch failed", dispatchError);
      }
    });
    return Response.json(snapshot, {
      status: 202,
      headers: {
        "Cache-Control": "no-store, private",
        Location: `/api/document-v2/jobs/${snapshot.job.jobId}`,
      },
    });
  } catch (caught) {
    if (caught instanceof z.ZodError) {
      return Response.json({ error: "文档生成请求格式不完整。", issues: caught.issues }, { status: 400 });
    }
    console.error("[document-v2-create]", caught);
    return Response.json({ error: "暂时无法创建文档任务。" }, { status: 500 });
  }
}
