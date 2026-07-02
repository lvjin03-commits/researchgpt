import { LiteratureError } from "@/lib/literature/errors";
import {
  deleteLiteratureFolder,
  updateLiteratureFolder,
} from "@/lib/literature/server/folder-repository";
import { parseFolderName } from "@/lib/literature/server/parse";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const body = await request.json();
    const name = parseFolderName(body);
    const folder = await updateLiteratureFolder(supabase, user.id, id, name);

    return Response.json({ folder });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PATCH folder failed:", error);
    return Response.json({ error: "Failed to update folder." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    await deleteLiteratureFolder(supabase, user.id, id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] DELETE folder failed:", error);
    return Response.json({ error: "Failed to delete folder." }, { status: 500 });
  }
}
