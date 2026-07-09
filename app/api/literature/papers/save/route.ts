import { LiteratureError } from "@/lib/literature/errors";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { parseExtensionFolderIds } from "@/lib/literature/server/extension-paper";
import { archiveLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import {
  stripLiteraturePaperFullTextForResponse,
  updateLiteraturePaperStatus,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import type { ArxivPaperDraft, LiteraturePaper } from "@/lib/literature/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type SaveSnapshotRequest = {
  paper?: unknown;
  folderIds?: unknown;
};

function assertPdfStored(paper: LiteraturePaper): void {
  if (paper.pdfDownloadStatus === "stored") {
    return;
  }

  const reason =
    paper.pdfDownloadStatus === "unavailable"
      ? "未找到可直接下载的 PDF 链接。"
      : paper.pdfDownloadError || "PDF 下载失败。";

  throw new LiteratureError(`保存前需要先下载 PDF：${reason}`, 422);
}

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

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = (await request.json()) as SaveSnapshotRequest;
    const draft = parsePaperSnapshot(body.paper);

    if (!draft) {
      throw new LiteratureError("Invalid paper payload.", 400);
    }

    const folderIds = parseExtensionFolderIds(body.folderIds);

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
      throw new LiteratureError("Paper could not be saved before PDF download.", 500);
    }

    let paper = await updateLiteraturePaperStatus(
      supabase,
      user.id,
      savedDraftPaper.id,
      "saved",
    );
    paper = await archiveLiteraturePaperPdf(supabase, user.id, paper);
    assertPdfStored(paper);

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

    console.error("[literature] save paper snapshot failed:", error);
    return Response.json({ error: "Failed to save paper." }, { status: 500 });
  }
}
