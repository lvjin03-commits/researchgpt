import { requireChatUser, toChatApiErrorResponse } from "@/lib/chat/server/errors";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireChatUser();
    const { id } = await context.params;
    const supabase = await createClient();

    const [{ data: job, error: jobError }, { data: events, error: eventsError }] =
      await Promise.all([
        supabase
          .from("document_generation_jobs")
          .select(
            [
              "id",
              "pipeline_version",
              "request_chars",
              "requested_formats",
              "status",
              "current_stage",
              "route_decision",
              "template_id",
              "template_version",
              "artifact_ids",
              "error_code",
              "error_message",
              "started_at",
              "finished_at",
              "updated_at",
            ].join(","),
          )
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("document_generation_events")
          .select(
            [
              "id",
              "stage",
              "component_id",
              "attempt",
              "status",
              "duration_ms",
              "details",
              "error_code",
              "error_message",
              "created_at",
            ].join(","),
          )
          .eq("job_id", id)
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
      ]);

    if (jobError) throw jobError;
    if (eventsError) throw eventsError;
    if (!job) {
      return Response.json({ error: "没有找到该文件任务。" }, { status: 404 });
    }

    return Response.json(
      { job, events: events ?? [] },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    const { body, status } = toChatApiErrorResponse(error);
    return Response.json(body, { status });
  }
}
