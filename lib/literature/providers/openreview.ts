// Server-only module.

import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_MAX_ARXIV_RESULTS,
} from "@/lib/literature/constants";
import {
  buildExternalKey,
  normalizeArxivId,
  normalizeDoi,
  type LiteratureProvider,
  type ProviderSearchOptions,
  type UnifiedPaper,
} from "@/lib/literature/providers/base";

const OPENREVIEW_API_BASE = "https://api2.openreview.net";
const OPENREVIEW_USER_AGENT =
  "ResearchGPT/1.0 (https://github.com/researchgpt; literature tracker)";

type OpenReviewFieldValue<T = string> = {
  value?: T;
};

type OpenReviewNoteContent = {
  title?: OpenReviewFieldValue;
  abstract?: OpenReviewFieldValue;
  authors?: OpenReviewFieldValue<string[]>;
  venue?: OpenReviewFieldValue;
  venueid?: OpenReviewFieldValue;
  pdf?: OpenReviewFieldValue;
  html?: OpenReviewFieldValue;
};

export type OpenReviewNote = {
  id: string;
  forum?: string;
  pdate?: number;
  cdate?: number;
  content?: OpenReviewNoteContent;
};

type OpenReviewSearchResponse = {
  notes?: OpenReviewNote[];
  count?: number;
};

type OpenReviewNotesResponse = {
  notes?: OpenReviewNote[];
};

function readContentValue<T>(
  content: OpenReviewNoteContent | undefined,
  field: keyof OpenReviewNoteContent,
): T | null {
  const fieldValue = content?.[field];
  if (!fieldValue || typeof fieldValue !== "object") {
    return null;
  }

  const value = (fieldValue as OpenReviewFieldValue<T>).value;
  return value ?? null;
}

function timestampToPublishedAt(timestamp: number | undefined): string | null {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractDoiFromNote(content: OpenReviewNoteContent | undefined): string | null {
  const html = readContentValue<string>(content, "html");
  if (html) {
    const doi = normalizeDoi(html);
    if (doi) {
      return doi;
    }
  }

  const pdf = readContentValue<string>(content, "pdf");
  if (pdf) {
    const doi = normalizeDoi(pdf);
    if (doi) {
      return doi;
    }
  }

  return null;
}

function extractArxivIdFromNote(content: OpenReviewNoteContent | undefined): string | null {
  const pdf = readContentValue<string>(content, "pdf");
  if (pdf) {
    const match = pdf.match(/arxiv\.org\/pdf\/([^/?#]+)/i);
    if (match?.[1]) {
      return normalizeArxivId(match[1]);
    }
  }

  const html = readContentValue<string>(content, "html");
  if (html) {
    const match = html.match(/arxiv\.(\d{4}\.\d+)/i);
    if (match?.[1]) {
      return normalizeArxivId(match[1]);
    }
  }

  return null;
}

function buildOpenReviewCategories(content: OpenReviewNoteContent | undefined): string[] {
  const categories: string[] = [];
  const venue = readContentValue<string>(content, "venue")?.trim();

  if (venue) {
    categories.push(venue);
  }

  const venueId = readContentValue<string>(content, "venueid")?.trim();
  if (venueId && venueId !== venue) {
    categories.push(venueId);
  }

  return categories;
}

function paperWithinDateRange(
  publishedAt: string | null,
  dateRangeDays: number | undefined,
): boolean {
  if (!dateRangeDays || dateRangeDays === 0 || !publishedAt) {
    return true;
  }

  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) {
    return true;
  }

  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - dateRangeDays);
  return publishedTime >= startDate.getTime();
}

function buildForumUrl(note: OpenReviewNote): string {
  const forumId = note.forum?.trim() || note.id;
  return `https://openreview.net/forum?id=${forumId}`;
}

function normalizeOpenReviewNote(note: OpenReviewNote): UnifiedPaper | null {
  const openReviewId = note.id?.trim();
  const title = readContentValue<string>(note.content, "title")?.trim() ?? "";

  if (!openReviewId || !title) {
    return null;
  }

  const abstract =
    readContentValue<string>(note.content, "abstract")?.trim() || "暂无摘要。";
  const authors = readContentValue<string[]>(note.content, "authors") ?? [];
  const doi = extractDoiFromNote(note.content);
  const arxivId = extractArxivIdFromNote(note.content);
  const absUrl = buildForumUrl(note);
  const pdfUrl =
    readContentValue<string>(note.content, "pdf")?.trim() ||
    `https://openreview.net/pdf?id=${openReviewId}`;
  const publishedAt =
    timestampToPublishedAt(note.pdate) ?? timestampToPublishedAt(note.cdate);
  const categories = buildOpenReviewCategories(note.content);

  if (doi && !categories.some((item) => item.toLowerCase().startsWith("doi:"))) {
    categories.unshift(`doi:${doi}`);
  }

  return {
    provider: "openreview",
    providerPaperId: openReviewId,
    externalKey: buildExternalKey("openreview", openReviewId),
    title,
    abstract,
    authors: authors.map((name) => name.trim()).filter(Boolean),
    publishedAt,
    pdfUrl,
    absUrl,
    categories,
    doi,
    arxivId,
    pubmedId: null,
    openAlexId: null,
    openReviewId,
    citationCount: null,
    providers: ["openreview"],
    sourceUrls: { openreview: absUrl },
  };
}

async function fetchOpenReviewSearchNotes(
  options: ProviderSearchOptions,
): Promise<OpenReviewNote[]> {
  const keywords = options.keywords.trim();
  if (!keywords) {
    return [];
  }

  const maxResults = Math.min(
    options.maxResults ?? LITERATURE_MAX_ARXIV_RESULTS,
    LITERATURE_MAX_ARXIV_RESULTS,
  );

  const url = new URL(`${OPENREVIEW_API_BASE}/notes/search`);
  url.searchParams.set("term", keywords);
  url.searchParams.set("content", "all");
  url.searchParams.set("source", "forum");
  url.searchParams.set("limit", String(maxResults));

  console.log("[openreview] search url:", url.toString());

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": OPENREVIEW_USER_AGENT,
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    console.warn("[openreview] search request failed:", reason);
    return [];
  }

  if (!response.ok) {
    const body = await response.text();
    console.warn(
      "[openreview] non-ok response:",
      response.status,
      body.slice(0, 500),
    );
    return [];
  }

  const payload = (await response.json()) as OpenReviewSearchResponse;
  const notes = payload.notes ?? [];
  const dateRangeDays = options.dateRangeDays ?? LITERATURE_DATE_RANGE_DAYS;

  return notes.filter((note) =>
    paperWithinDateRange(
      timestampToPublishedAt(note.pdate) ?? timestampToPublishedAt(note.cdate),
      dateRangeDays,
    ),
  );
}

async function fetchOpenReviewNoteById(
  providerPaperId: string,
): Promise<OpenReviewNote | null> {
  const noteId = providerPaperId.replace(/^openreview:/i, "").trim();
  if (!noteId) {
    return null;
  }

  const url = new URL(`${OPENREVIEW_API_BASE}/notes`);
  url.searchParams.set("id", noteId);

  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": OPENREVIEW_USER_AGENT,
      },
      next: { revalidate: 0 },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network error";
    console.warn("[openreview] get note request failed:", reason);
    return null;
  }

  if (!response.ok) {
    console.warn("[openreview] get note non-ok response:", response.status);
    return null;
  }

  const payload = (await response.json()) as OpenReviewNotesResponse;
  return payload.notes?.[0] ?? null;
}

export const openReviewProvider: LiteratureProvider = {
  id: "openreview",
  name: "OpenReview",
  enabled: true,

  async searchPapers(options) {
    return fetchOpenReviewSearchNotes(options);
  },

  async getPaper(providerPaperId) {
    return fetchOpenReviewNoteById(providerPaperId);
  },

  normalizePaper(raw) {
    const paper = normalizeOpenReviewNote(raw as OpenReviewNote);
    if (!paper) {
      throw new Error("Invalid OpenReview paper payload.");
    }
    return paper;
  },
};
