import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import { requireExtensionUser } from "@/lib/literature/server/extension-auth";
import {
  parseExtensionFolderIds,
  parseExtensionScholarPaper,
} from "@/lib/literature/server/extension-paper";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { archiveUploadedLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import {
  deleteLiteraturePaper,
  upsertLiteraturePaperDraft,
} from "@/lib/literature/server/repository";

export const runtime = "nodejs";
export const maxDuration = 120;

function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function assertPdfFile(value: FormDataEntryValue | null): File {
  if (!(value instanceof File)) {
    throw new LiteratureError("Please upload a PDF file.", 400);
  }

  if (value.size <= 0) {
    throw new LiteratureError("Uploaded PDF is empty.", 422);
  }

  const name = value.name.toLowerCase();
  const type = value.type.toLowerCase();
  if (!name.endsWith(".pdf") && !type.includes("pdf")) {
    throw new LiteratureError("Uploaded file must be a PDF.", 415);
  }

  return value;
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireExtensionUser(request);
    const formData = await request.formData();
    const draft = parseExtensionScholarPaper(parseJsonField(formData.get("paper")));
    const folderIds = parseExtensionFolderIds(parseJsonField(formData.get("folderIds")));
    const file = assertPdfFile(formData.get("file"));

    if (!draft) {
      throw new LiteratureError("Invalid paper payload.", 400);
    }

    const savedDraftPaper = await upsertLiteraturePaperDraft(
      supabase,
      user.id,
      draft,
      "saved",
    );

    try {
      const archivedPaper = await archiveUploadedLiteraturePaperPdf(
        supabase,
        user.id,
        savedDraftPaper,
        file,
      );

      if (folderIds.length > 0) {
        await setPaperFolderIds(supabase, user.id, archivedPaper.id, folderIds);
      }

      return Response.json(
        {
          saved: {
            id: archivedPaper.id,
            title: archivedPaper.title,
            arxivId: archivedPaper.arxivId,
          },
          count: 1,
        },
        { headers: extensionCorsHeaders(request) },
      );
    } catch (error) {
      await deleteLiteraturePaper(supabase, user.id, savedDraftPaper.id).catch(
        (cleanupError) => {
          console.warn("[extension] failed to clean up uploaded PDF save:", cleanupError);
        },
      );

      throw error;
    }
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

    console.error("[extension] upload-paper failed:", error);
    return Response.json(
      { error: "Failed to upload paper PDF." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}
