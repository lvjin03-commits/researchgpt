import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import {
  parseExtensionFolderIds,
  parseExtensionScholarPaper,
  saveExtensionPaper,
} from "@/lib/literature/server/extension-paper";
import {
  listLiteraturePapers,
  stripLiteraturePaperFullTextForResponse,
} from "@/lib/literature/server/repository";

export const runtime = "nodejs";
export const maxDuration = 120;

type ScholarImportRequest = {
  papers?: unknown;
  folderIds?: unknown;
};

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = (await request.json()) as ScholarImportRequest;
    const rawPapers = Array.isArray(body.papers) ? body.papers : [];
    const folderIds = parseExtensionFolderIds(body.folderIds);
    const drafts = rawPapers
      .map(parseExtensionScholarPaper)
      .filter((paper) => paper !== null)
      .slice(0, 50);

    if (drafts.length === 0) {
      throw new LiteratureError("No valid Google Scholar papers to import.", 400);
    }

    const imported = [];

    for (const draft of drafts) {
      imported.push(
        await saveExtensionPaper(supabase, user.id, draft, folderIds),
      );
    }

    return Response.json(
      {
        imported,
        count: imported.length,
        papers: (await listLiteraturePapers(supabase, user.id)).map(
          stripLiteraturePaperFullTextForResponse,
        ),
      },
      { headers: extensionCorsHeaders(request) },
    );
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json(
        { error: error.message },
        {
          status: error.statusCode,
          headers: extensionCorsHeaders(request),
        },
      );
    }

    console.error("[literature] Google Scholar import failed:", error);
    return Response.json(
      { error: "Failed to import Google Scholar papers." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}
