import { LiteratureError } from "@/lib/literature/errors";
import { getPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { parsePersonalNotes } from "@/lib/literature/server/parse";
import {
  getLiteraturePaperById,
  updateLiteraturePaperNotes,
} from "@/lib/literature/server/repository";
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
    const notes = parsePersonalNotes(body);
    const paper = await updateLiteraturePaperNotes(supabase, user.id, id, notes);
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({ paper: { ...paper, folderIds } });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PATCH paper notes failed:", error);
    return Response.json({ error: "Failed to save paper notes." }, { status: 500 });
  }
}
