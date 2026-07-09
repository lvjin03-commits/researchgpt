import { LiteratureError } from "@/lib/literature/errors";
import { parseExtensionFolderIds } from "@/lib/literature/server/extension-paper";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { archiveUploadedLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import {
  stripLiteraturePaperFullTextForResponse,
  updateLiteraturePaperStatus,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import type { ArxivPaperDraft, LiteraturePaper } from "@/lib/literature/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parsePaperSnapshot(raw: unknown): ArxivPaperDraft | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Partial<LiteraturePaper>;
  const title = cleanString(record.title);
  const arxivId = cleanString(record.arxivId);
  const absUrl = cleanString(record.absUrl);

  if (!title || !arxivId || !absUrl) {
    return null;
  }

  return {
    arxivId,
    title,
    abstract: cleanString(record.abstract) || "No abstract available.",
    authors: cleanStringArray(record.authors),
    publishedAt: cleanString(record.publishedAt) || null,
    pdfUrl: cleanString(record.pdfUrl) || absUrl,
    absUrl,
    categories: cleanStringArray(record.categories),
    providers: record.providers,
    sourceUrls: record.sourceUrls,
    citationCount:
      typeof record.citationCount === "number" ? record.citationCount : null,
    rankingScore:
      typeof record.rankingScore === "number" ? record.rankingScore : undefined,
  };
}

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

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const formData = await request.formData();
    const draft = parsePaperSnapshot(parseJsonField(formData.get("paper")));
    const folderIds = parseExtensionFolderIds(parseJsonField(formData.get("folderIds")));
    const file = assertPdfFile(formData.get("file"));

    if (!draft) {
      throw new LiteratureError("Invalid paper payload.", 400);
    }

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
      throw new LiteratureError("Paper could not be saved before PDF upload.", 500);
    }

    let paper = await updateLiteraturePaperStatus(
      supabase,
      user.id,
      savedDraftPaper.id,
      "saved",
    );
    paper = await archiveUploadedLiteraturePaperPdf(supabase, user.id, paper, file);

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
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] upload paper PDF failed:", error);
    return Response.json({ error: "Failed to upload PDF." }, { status: 500 });
  }
}
