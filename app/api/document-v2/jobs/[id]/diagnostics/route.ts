import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getDocumentJobDiagnostics } from "@/lib/document-v2/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readDiagnosticDataConfig() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Document diagnostics data access is not configured.");
  }
  return { supabaseUrl, serviceRoleKey };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const userClient = await createClient();
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) {
    return Response.json({ error: "请先登录。" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const config = readDiagnosticDataConfig();
    const adminClient = createAdminClient(
      config.supabaseUrl,
      config.serviceRoleKey,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const diagnostics = await getDocumentJobDiagnostics({
      userClient,
      adminClient,
      jobId: id,
    });
    if (!diagnostics) {
      return Response.json({ error: "没有找到该文档任务。" }, { status: 404 });
    }
    return Response.json(diagnostics, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (caught) {
    console.error("[document-v2-diagnostics]", {
      operation: "diagnostics.read.failed",
      errorType: caught instanceof Error ? caught.name : "UnknownError",
    });
    return Response.json(
      { error: "暂时无法读取诊断信息。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
