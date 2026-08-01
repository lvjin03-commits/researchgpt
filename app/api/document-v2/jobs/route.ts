import { z } from "zod";
import {
  DEFAULT_CHAT_MODEL_TIER,
  getChatModelOption,
  isChatModelTier,
} from "@/lib/ai/chat-models";
import { createClient } from "@/lib/supabase/server";
import { VerifiedReferenceSchema } from "@/lib/document-v2/contracts";
import { DocumentEvidenceItemSchema } from "@/lib/document-v2/runtime/contracts";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentV2JobService } from "@/lib/document-v2/runtime/job-service";
import { DocumentJobConflictError } from "@/lib/document-v2/runtime/repository";
import { getDocumentJobSnapshot } from "@/lib/document-v2/runtime/controls";
import {
  dispatchDocumentV2Worker,
  logDocumentV2DispatchFailure,
  recordDocumentV2DispatchFailure,
} from "@/lib/document-v2-production/dispatch";
import {
  DocumentV2ConfigurationError,
  DocumentV2PublicRuntimeDisabledError,
  requireDocumentV2PublicRuntime,
} from "@/lib/document-v2-production/runtime-config";

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
    modelTier: z.string().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    requireDocumentV2PublicRuntime();
  } catch (error) {
    if (error instanceof DocumentV2PublicRuntimeDisabledError) {
      return Response.json({ error: "新的文档生成主线尚未开放。" }, { status: 404 });
    }
    if (error instanceof DocumentV2ConfigurationError) {
      console.error("[document-v2-create]", {
        operation: "intake.configuration.invalid",
        missing: error.missing,
        invalid: error.invalid,
      });
      return Response.json(
        {
          error: "文档服务暂时不可用，任务尚未开始。",
          code: "document_v2_runtime_not_ready",
        },
        {
          status: 503,
          headers: { "Retry-After": "60", "Cache-Control": "no-store" },
        },
      );
    }
    throw error;
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
    const modelOption = getChatModelOption(
      isChatModelTier(input.modelTier)
        ? input.modelTier
        : DEFAULT_CHAT_MODEL_TIER,
    );
    const service = new DocumentV2JobService(
      repository,
      {
        generator: { async generate() { throw new Error("Creation API does not execute jobs."); } },
        validator: { async validate() { return { accepted: true }; } },
      },
      {
        async renderAndStore() {
          throw new Error("Creation API does not finalize jobs.");
        },
        async validateArtifact() {
          throw new Error("Creation API does not validate artifacts.");
        },
      },
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
        textExecution: {
          provider: modelOption.provider,
          requestedModelId: modelOption.model,
          resolvedModelId: modelOption.model,
          maxOutputTokens: modelOption.maxOutputTokens,
          reasoningEffort: modelOption.reasoningEffort,
          allowProviderFallback: false,
        },
      });
    } catch (creationError) {
      if (!(creationError instanceof DocumentJobConflictError)) throw creationError;
      snapshot = await getDocumentJobSnapshot(
        repository,
        input.idempotencyKey,
      );
    }
    try {
      await dispatchDocumentV2Worker({
        cause: "job_created",
        requestUrl: request.url,
        jobId: snapshot.job.jobId,
      });
    } catch (dispatchError) {
      logDocumentV2DispatchFailure({
        cause: "job_created",
        jobId: snapshot.job.jobId,
        error: dispatchError,
      });
      await recordDocumentV2DispatchFailure({
        repository,
        cause: "job_created",
        jobId: snapshot.job.jobId,
        error: dispatchError,
      });
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
