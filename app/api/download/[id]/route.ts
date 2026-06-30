import { createClient } from "@/lib/supabase/server";
import { getExportForUser, readExportBuffer } from "@/lib/export/store";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return Response.json({ error: "Invalid download id." }, { status: 400 });
    }

    const record = await getExportForUser(id, user.id);

    if (!record) {
      return Response.json(
        { error: "Export not found or expired." },
        { status: 404 },
      );
    }

    const buffer = await readExportBuffer(record);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": record.mimeType,
        "Content-Disposition": `attachment; filename="${record.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/download] Failed to serve export:", error);
    return Response.json({ error: "Failed to download export." }, { status: 500 });
  }
}
