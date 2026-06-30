import { createClient } from "@/lib/supabase/server";
import { ExportError } from "@/lib/export/errors";
import { createExport, parseExportRequest } from "@/lib/export/service";
import type { ExportErrorResponse } from "@/lib/export/types";

export const runtime = "nodejs";

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
  try {
    const user = await requireUser();

    if (!user) {
      return Response.json(
        { success: false, error: "Unauthorized" } satisfies ExportErrorResponse,
        { status: 401 },
      );
    }

    const body = await request.json();
    const exportRequest = parseExportRequest(body);
    const result = await createExport(exportRequest, user.id);

    return Response.json(result);
  } catch (error) {
    if (error instanceof ExportError) {
      return Response.json(
        { success: false, error: error.message } satisfies ExportErrorResponse,
        { status: error.statusCode },
      );
    }

    console.error("[api/export] Failed to create export:", error);

    return Response.json(
      {
        success: false,
        error: "Failed to generate export file.",
      } satisfies ExportErrorResponse,
      { status: 500 },
    );
  }
}
