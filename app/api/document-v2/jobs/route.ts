import OpenAI from "openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VerifiedReferenceSchema } from "@/lib/document-v2/contracts";
import { resolveDocumentTemplate } from "@/lib/document-v2/templates/resolver";
import { createDocumentPlanFromTemplate } from "@/lib/document-v2/planning/planner";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { DocumentJobConflictError } from "@/lib/document-v2/runtime/repository";
import { getDocumentJobSnapshot } from "@/lib/document-v2/runtime/controls";
import {
  OpenAISemanticOutlinePlanner,
  OpenAITemplateMatcher,
  understandDocumentRequest,
} from "@/lib/document-v2-production/planning";

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
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const documentRequest = await understandDocumentRequest(openai, input);
    const template = await resolveDocumentTemplate({
      request: documentRequest,
      matcher: new OpenAITemplateMatcher(openai),
    });
    const references = input.verifiedReferences ?? [];
    const plan = await createDocumentPlanFromTemplate({
      request: documentRequest,
      template,
      outlinePlanner: new OpenAISemanticOutlinePlanner(openai),
      availableEvidenceIds: references.map((reference) => reference.id),
    });
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
      snapshot = await service.create({
        ownerId: user.id,
        request: documentRequest,
        plan,
        verifiedReferences: references,
      });
    } catch (creationError) {
      if (!(creationError instanceof DocumentJobConflictError)) throw creationError;
      snapshot = await getDocumentJobSnapshot(
        repository,
        documentRequest.requestId,
      );
    }
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
