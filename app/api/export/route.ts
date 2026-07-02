import { createClient } from "@/lib/supabase/server";
import { ExportError } from "@/lib/export/errors";
import { createExport, parseExportRequest } from "@/lib/export/service";
import type { ExportErrorResponse } from "@/lib/export/types";

export const runtime = "nodejs";

function logExportError(error: unknown): void {
  if (error instanceof Error) {
    console.error("[export] error name:", error.name);
    console.error("[export] error message:", error.message);
    console.error("[export] error stack:", error.stack);
    return;
  }

  console.error("[export] error name:", typeof error);
  console.error("[export] error message:", String(error));
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function POST(request: Request) {
  console.log("[export] request received");

  try {
    const user = await requireUser();

    if (!user) {
      console.error("[export] unauthorized export request");
      return Response.json(
        { success: false, error: "Unauthorized" } satisfies ExportErrorResponse,
        { status: 401 },
      );
    }

    const body = await request.json();
    const exportRequest = parseExportRequest(body);

    console.log("[export] format:", exportRequest.format);
    console.log("[export] message count:", 1);
    console.log("[export] content length:", exportRequest.content.length);

    const result = await createExport(exportRequest, user.id);

    console.log("[export] created:", result.filename);

    return Response.json(result);
  } catch (error) {
    if (error instanceof ExportError) {
      logExportError(error);
      return Response.json(
        { success: false, error: error.message } satisfies ExportErrorResponse,
        { status: error.statusCode },
      );
    }

    logExportError(error);

    return Response.json(
      {
        success: false,
        error: "Failed to generate export file.",
      } satisfies ExportErrorResponse,
      { status: 500 },
    );
  }
}
