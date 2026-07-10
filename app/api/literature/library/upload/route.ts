import { createHash } from "crypto";
import { LiteratureError } from "@/lib/literature/errors";
import { parseExtensionFolderIds } from "@/lib/literature/server/extension-paper";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { archiveUploadedLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import {
  deleteLiteraturePaper,
  stripLiteraturePaperFullTextForResponse,
  updateLiteraturePaperStatus,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import type { ArxivPaperDraft } from "@/lib/literature/types";

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

function titleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Untitled PDF"
  );
}

function buildLocalUploadDraft(file: File): ArxivPaperDraft {
  const title = titleFromFileName(file.name);
  const digest = createHash("sha1")
    .update(`${file.name}:${file.size}:${file.lastModified}`)
    .digest("hex")
    .slice(0, 16);
  const localUrl = `local-pdf:${digest}`;

  return {
    arxivId: localUrl,
    title,
    abstract: "Local PDF uploaded to the literature library.",
    authors: [],
    publishedAt: null,
    pdfUrl: localUrl,
    absUrl: localUrl,
    categories: ["source:Local PDF"],
    citationCount: null,
    rankingScore: 100,
  };
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const formData = await request.formData();
    const file = assertPdfFile(formData.get("file"));
    const folderIds = parseExtensionFolderIds(parseJsonField(formData.get("folderIds")));
    const draft = buildLocalUploadDraft(file);

    const upserted = await upsertAnalyzedPapers(
      supabase,
      user.id,
      [draft],
      new Map(),
    );
    const savedDraftPaper = upserted.papers.find(
      (item) => item.arxivId === draft.arxivId,
    );

    if (!savedDraftPaper) {
      throw new LiteratureError("Uploaded paper could not be saved.", 500);
    }

    try {
      let paper = await updateLiteraturePaperStatus(
        supabase,
        user.id,
        savedDraftPaper.id,
        "saved",
      );
      paper = await archiveUploadedLiteraturePaperPdf(
        supabase,
        user.id,
        paper,
        file,
      );

      const assignedFolderIds = await setPaperFolderIds(
        supabase,
        user.id,
        paper.id,
        folderIds,
      );

      return Response.json({
        paper: stripLiteraturePaperFullTextForResponse({
          ...paper,
          folderIds: assignedFolderIds,
        }),
      });
    } catch (error) {
      await deleteLiteraturePaper(supabase, user.id, savedDraftPaper.id).catch(
        (cleanupError) => {
          console.warn("[literature] failed to clean up local PDF save:", cleanupError);
        },
      );
      throw error;
    }
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] local library PDF upload failed:", error);
    return Response.json({ error: "Failed to upload PDF." }, { status: 500 });
  }
}
