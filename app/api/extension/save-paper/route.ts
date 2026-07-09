import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import { requireExtensionUser } from "@/lib/literature/server/extension-auth";
import {
  parseExtensionFolderIds,
  parseExtensionScholarPaper,
  saveExtensionPaper,
} from "@/lib/literature/server/extension-paper";

export const runtime = "nodejs";
export const maxDuration = 120;

type SavePaperRequest = {
  paper?: unknown;
  folderIds?: unknown;
};

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireExtensionUser(request);
    const body = (await request.json()) as SavePaperRequest;
    const draft = parseExtensionScholarPaper(body.paper);

    if (!draft) {
      throw new LiteratureError("Invalid paper payload.", 400);
    }

    const folderIds = parseExtensionFolderIds(body.folderIds);
    const saved = await saveExtensionPaper(
      supabase,
      user.id,
      draft,
      folderIds,
    );

    return Response.json(
      {
        saved,
        count: 1,
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

    console.error("[extension] save-paper failed:", error);
    return Response.json(
      { error: "Failed to save paper." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}
