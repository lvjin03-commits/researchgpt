import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  DocumentJobNotFoundError,
  getDocumentJobSnapshot,
  requestDocumentJobCancellation,
  resumeDocumentJob,
} from "@/lib/document-v2/runtime/controls";
import { SupabaseDocumentJobRepository } from "@/lib/document-v2/runtime/supabase-repository";
import { DocumentJobConflictError } from "@/lib/document-v2/runtime/repository";

export const runtime = "nodejs";

const ControlSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("resume") }).strict(),
  z
    .object({
      action: z.literal("clarify"),
      questionId: z.uuid(),
      answer: z.string().trim().min(1).max(4_000),
    })
    .strict(),
]);

function disabledResponse() {
  return Response.json(
    { error: "新的文档任务系统尚未对当前环境开放。" },
    { status: 404 },
  );
}

async function authorizedRepository() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return {
    repository: new SupabaseDocumentJobRepository(supabase, user.id),
  };
}

function apiError(error: unknown) {
  if (error instanceof DocumentJobNotFoundError) {
    return Response.json({ error: "没有找到该文档任务。" }, { status: 404 });
  }
  if (error instanceof DocumentJobConflictError) {
    return Response.json(
      { error: "任务状态刚刚发生变化，请刷新后重试。" },
      { status: 409 },
    );
  }
  if (error instanceof z.ZodError) {
    return Response.json({ error: "任务操作无效。" }, { status: 400 });
  }
  console.error("[document-v2-api]", error);
  return Response.json(
    { error: "暂时无法读取文档任务状态。" },
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.DOCUMENT_V2_RUNTIME_ENABLED !== "true") {
    return disabledResponse();
  }
  const authorized = await authorizedRepository();
  if (!authorized) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const snapshot = await getDocumentJobSnapshot(
      authorized.repository,
      id,
    );
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (process.env.DOCUMENT_V2_RUNTIME_ENABLED !== "true") {
    return disabledResponse();
  }
  const authorized = await authorizedRepository();
  if (!authorized) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }
  try {
    const { id } = await context.params;
    const control = ControlSchema.parse(await request.json());
    let snapshot;
    if (control.action === "cancel") {
      snapshot = await requestDocumentJobCancellation(authorized.repository, id);
    } else if (control.action === "resume") {
      snapshot = await resumeDocumentJob(authorized.repository, id);
    } else {
      const current = await authorized.repository.get(id);
      if (
        !current ||
        current.status !== "awaiting_user_input" ||
        current.clarification?.questionId !== control.questionId ||
        !current.checkpoint.intake
      ) {
        return Response.json({ error: "补充问题已失效，请刷新任务状态。" }, { status: 409 });
      }
      const now = new Date().toISOString();
      await authorized.repository.save(
        {
          ...current,
          status: "queued",
          stage: "intake",
          clarification: undefined,
          checkpoint: {
            ...current.checkpoint,
            intake: {
              ...current.checkpoint.intake,
              instruction: `${current.checkpoint.intake.instruction}\n\n用户补充：${control.answer}`,
            },
            clarification: undefined,
            savedAt: now,
          },
          updatedAt: now,
        },
        current.revision,
      );
      snapshot = await getDocumentJobSnapshot(authorized.repository, id);
    }
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
