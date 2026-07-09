// Server-only module.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import {
  deleteLiteraturePaper,
  updateLiteraturePaperStatusByExternalKey,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { setPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { archiveLiteraturePaperPdf } from "@/lib/literature/server/pdf-archive";
import type { ArxivPaperDraft } from "@/lib/literature/types";

export type ExtensionScholarPaperInput = {
  title?: unknown;
  authors?: unknown;
  venue?: unknown;
  year?: unknown;
  snippet?: unknown;
  url?: unknown;
  citedByCount?: unknown;
  pdfUrl?: unknown;
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

export function buildScholarExternalKey(paper: {
  title: string;
  url: string;
}): string {
  const source = paper.url || paper.title;
  const digest = createHash("sha1").update(source).digest("hex").slice(0, 16);
  return `google-scholar:${digest}`;
}

export function parseExtensionScholarPaper(
  raw: unknown,
): ArxivPaperDraft | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as ExtensionScholarPaperInput;
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

export function parseExtensionFolderIds(value: unknown): string[] {
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

export async function saveExtensionPaper(
  supabase: SupabaseClient,
  userId: string,
  draft: ArxivPaperDraft,
  folderIds: string[],
): Promise<{ id: string; title: string; arxivId: string }> {
  await upsertAnalyzedPapers(supabase, userId, [draft], new Map());

  const paper = await updateLiteraturePaperStatusByExternalKey(
    supabase,
    userId,
    draft.arxivId,
    "saved",
  );
  const archivedPaper = await archiveLiteraturePaperPdf(supabase, userId, paper);

  if (archivedPaper.pdfDownloadStatus !== "stored") {
    await deleteLiteraturePaper(supabase, userId, archivedPaper.id).catch((error) => {
      console.warn("[extension] failed to clean up paper without stored PDF:", error);
    });

    throw new LiteratureError(
      archivedPaper.pdfDownloadError ||
        "PDF could not be downloaded or stored. Please try another direct PDF result.",
      422,
    );
  }

  if (folderIds.length > 0) {
    await setPaperFolderIds(supabase, userId, archivedPaper.id, folderIds);
  }

  return {
    id: archivedPaper.id,
    title: archivedPaper.title,
    arxivId: archivedPaper.arxivId,
  };
}
