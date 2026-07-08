import { createHash } from "crypto";
import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import {
  listLiteraturePapers,
  updateLiteraturePaperStatusByExternalKey,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import type { ArxivPaperDraft } from "@/lib/literature/types";

export const runtime = "nodejs";

type ScholarImportPaper = {
  title?: unknown;
  authors?: unknown;
  venue?: unknown;
  year?: unknown;
  snippet?: unknown;
  url?: unknown;
  citedByCount?: unknown;
  pdfUrl?: unknown;
};

type ScholarImportRequest = {
  papers?: unknown;
  folderIds?: unknown;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const raw = cleanString(value);
  if (!raw) {
    return [];
  }

  return raw
    .split(/,|;|\band\b/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeYear(value: unknown): string | null {
  const raw = cleanString(value);
  const match = raw.match(/\b(19|20)\d{2}\b/);
  return match ? `${match[0]}-01-01` : null;
}

function buildScholarExternalKey(paper: {
  title: string;
  url: string;
}): string {
  const source = paper.url || paper.title;
  const digest = createHash("sha1").update(source).digest("hex").slice(0, 16);
  return `google-scholar:${digest}`;
}

function parsePaper(raw: unknown): ArxivPaperDraft | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as ScholarImportPaper;
  const title = cleanString(record.title);
  const url = cleanString(record.url);

  if (!title || !url) {
    return null;
  }

  const venue = cleanString(record.venue);
  const year = cleanString(record.year);
  const citedByCount = Number(record.citedByCount);
  const categories = ["source:Google Scholar"];

  if (venue) {
    categories.push(venue);
  }

  if (year) {
    categories.push(`year:${year}`);
  }

  return {
    arxivId: buildScholarExternalKey({ title, url }),
    title,
    abstract: cleanString(record.snippet) || "No abstract available.",
    authors: cleanAuthors(record.authors),
    publishedAt: normalizeYear(record.year),
    pdfUrl: cleanString(record.pdfUrl) || url,
    absUrl: url,
    categories,
    citationCount: Number.isFinite(citedByCount) ? citedByCount : null,
    providers: ["google_scholar"],
    sourceUrls: { google_scholar: url },
    rankingScore: 100,
  };
}

function parseFolderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = (await request.json()) as ScholarImportRequest;
    const rawPapers = Array.isArray(body.papers) ? body.papers : [];
    const folderIds = parseFolderIds(body.folderIds);
    const drafts = rawPapers
      .map(parsePaper)
      .filter((paper): paper is ArxivPaperDraft => paper !== null)
      .slice(0, 50);

    if (drafts.length === 0) {
      throw new LiteratureError("No valid Google Scholar papers to import.", 400);
    }

    await upsertAnalyzedPapers(supabase, user.id, drafts, new Map());

    const imported: Array<{ id: string; title: string; arxivId: string }> = [];

    for (const draft of drafts) {
      const paper = await updateLiteraturePaperStatusByExternalKey(
        supabase,
        user.id,
        draft.arxivId,
        "saved",
      );

      if (folderIds.length > 0) {
        await setPaperFolderIds(supabase, user.id, paper.id, folderIds);
      }

      imported.push({
        id: paper.id,
        title: paper.title,
        arxivId: paper.arxivId,
      });
    }

    return Response.json(
      {
        imported,
        count: imported.length,
        papers: await listLiteraturePapers(supabase, user.id),
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
