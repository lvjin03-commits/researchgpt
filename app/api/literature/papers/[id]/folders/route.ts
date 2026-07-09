import { LiteratureError } from "@/lib/literature/errors";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { parsePaperFolderIds } from "@/lib/literature/server/parse";
import { getLiteraturePaperById } from "@/lib/literature/server/repository";
import { archiveLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const body = await request.json();
    const folderIds = parsePaperFolderIds(body);

    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const assignedFolderIds = await setPaperFolderIds(
      supabase,
      user.id,
      id,
      folderIds,
    );

    if (paper.status === "saved") {
      await archiveLiteraturePaperPdf(supabase, user.id, paper);
    }

    return Response.json({ paperId: id, folderIds: assignedFolderIds });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PUT paper folders failed:", error);
    return Response.json({ error: "Failed to update paper folders." }, { status: 500 });
  }
}
