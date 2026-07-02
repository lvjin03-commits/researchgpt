import { LiteratureError } from "@/lib/literature/errors";
import { getPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { parsePaperStatus } from "@/lib/literature/server/parse";
import {
  getLiteraturePaperById,
  updateLiteraturePaperStatus,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({ paper: { ...paper, folderIds } });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET paper failed:", error);
    return Response.json({ error: "Failed to load paper." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const body = await request.json();
    const status = parsePaperStatus(body);
    const paper = await updateLiteraturePaperStatus(
      supabase,
      user.id,
      id,
      status,
    );
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({ paper: { ...paper, folderIds } });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PATCH paper failed:", error);
    return Response.json({ error: "Failed to update paper status." }, { status: 500 });
  }
}
