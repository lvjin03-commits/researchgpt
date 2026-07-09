import { LiteratureError } from "@/lib/literature/errors";
import { getPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { parsePaperStatus } from "@/lib/literature/server/parse";
import {
  deleteLiteraturePaper,
  getLiteraturePaperById,
  stripLiteraturePaperFullTextForResponse,
  updateLiteraturePaperStatus,
} from "@/lib/literature/server/repository";
import { archiveLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({
      paper: stripLiteraturePaperFullTextForResponse({ ...paper, folderIds }),
    });
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
    let paper = await updateLiteraturePaperStatus(
      supabase,
      user.id,
      id,
      status,
    );
    if (status === "saved") {
      paper = await archiveLiteraturePaperPdf(supabase, user.id, paper);
    }
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({
      paper: stripLiteraturePaperFullTextForResponse({ ...paper, folderIds }),
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] PATCH paper failed:", error);
    return Response.json({ error: "Failed to update paper status." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;

    await deleteLiteraturePaper(supabase, user.id, id);

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] DELETE paper failed:", error);
    return Response.json({ error: "Failed to delete paper." }, { status: 500 });
  }
}
