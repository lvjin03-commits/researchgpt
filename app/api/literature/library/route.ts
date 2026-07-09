import { LiteratureError } from "@/lib/literature/errors";
import { parseLibraryFilters } from "@/lib/literature/server/library";
import { listLiteratureFolderPapers } from "@/lib/literature/server/folder-papers";
import {
  getPaperFolderIdsMap,
  listLiteratureFolders,
} from "@/lib/literature/server/folder-repository";
import { listLiteratureLibraryPapers } from "@/lib/literature/server/repository";
import { stripLiteraturePaperFullTextForResponse } from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { searchParams } = new URL(request.url);
    const filters = parseLibraryFilters(searchParams);
    const [paperFolderIds, folders] = await Promise.all([
      getPaperFolderIdsMap(supabase, user.id),
      listLiteratureFolders(supabase, user.id),
    ]);
    const papers = filters.folderId
      ? await listLiteratureFolderPapers(supabase, user.id, filters.folderId)
      : await listLiteratureLibraryPapers(
          supabase,
          user.id,
          filters,
          paperFolderIds,
        );

    return Response.json({
      papers: papers.map(stripLiteraturePaperFullTextForResponse),
      folders,
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET library failed:", error);
    return Response.json({ error: "Failed to load literature library." }, { status: 500 });
  }
}
