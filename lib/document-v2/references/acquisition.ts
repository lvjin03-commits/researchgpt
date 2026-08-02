import { createHash } from "node:crypto";
import type { VerifiedReference } from "../contracts";
import {
  ReferenceEvidenceSchema,
  ReferencePipelineResultSchema,
  type ReferenceExecutionProfile,
  type ReferencePipelineResult,
} from "./contracts";
import type { z } from "zod";

type ReferenceEvidence = z.infer<typeof ReferenceEvidenceSchema>;
type FetchLike = typeof fetch;

type Candidate = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  provider: "crossref" | "openalex";
  providerRecordId: string;
};

const MAX_REFERENCES = 12;
const MIN_COMPLETE_REFERENCES = 6;
const PROVIDER_TIMEOUT_MS = 8_000;
const SEARCH_STOP_WORDS = new Set([
  "about", "after", "against", "among", "and", "are", "based", "between",
  "for", "from", "into", "method", "methods", "of", "on", "review", "study",
  "the", "their", "through", "toward", "using", "with",
]);

function cleanText(value: unknown, maximum = 20_000): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, maximum) : undefined;
}

function normalizeDoi(value: unknown): string | undefined {
  const text = cleanText(value, 300)
    ?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[\s.,;]+$/g, "")
    .toLowerCase();
  return text?.startsWith("10.") ? text : undefined;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function searchTerms(value: string): Set<string> {
  const terms = value
    .normalize("NFKC")
    .toLowerCase()
    .match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  return new Set(
    terms
      .map((term) => term.replace(/(?:ies|ing|ed|es|s)$/i, ""))
      .filter((term) => term.length >= 3 && !SEARCH_STOP_WORDS.has(term)),
  );
}

function isRelevantCandidate(candidate: Candidate, queryTerms: Set<string>): boolean {
  if (queryTerms.size < 2) return true;
  const candidateTerms = searchTerms(
    `${candidate.title} ${candidate.abstract ?? ""}`,
  );
  let overlap = 0;
  for (const term of queryTerms) {
    const matched = [...candidateTerms].some(
      (candidateTerm) =>
        candidateTerm === term ||
        (term === "gel" && candidateTerm.endsWith("gel")) ||
        (term.length >= 7 &&
          candidateTerm.length >= 7 &&
          candidateTerm.slice(0, 6) === term.slice(0, 6)),
    );
    if (matched) overlap += 1;
  }
  return overlap >= Math.min(2, queryTerms.size);
}

function candidateKey(candidate: Pick<Candidate, "doi" | "title">): string {
  return candidate.doi
    ? `doi:${candidate.doi}`
    : `title:${normalizeTitle(candidate.title)}`;
}

function referenceId(candidate: Candidate): string {
  return `literature-${createHash("sha256")
    .update(candidateKey(candidate))
    .digest("hex")
    .slice(0, 24)}`;
}

function yearFromDateParts(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  if (!Array.isArray(first) || typeof first[0] !== "number") return undefined;
  return first[0];
}

function crossrefCandidates(payload: unknown): Candidate[] {
  const items = (payload as { message?: { items?: unknown[] } })?.message?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const title = cleanText(Array.isArray(item.title) ? item.title[0] : item.title, 1_000);
    const rawAuthors = Array.isArray(item.author) ? item.author : [];
    const authors = rawAuthors.flatMap((rawAuthor) => {
      const author = rawAuthor as Record<string, unknown>;
      const name = cleanText(
        [author.given, author.family].filter((part) => typeof part === "string").join(" "),
        300,
      );
      return name ? [name] : [];
    });
    if (!title || authors.length === 0) return [];
    const doi = normalizeDoi(item.DOI);
    const providerRecordId = doi ?? cleanText(item.URL, 120) ?? title.slice(0, 120);
    return [{
      title,
      authors,
      year:
        yearFromDateParts((item.published as { "date-parts"?: unknown })?.["date-parts"]) ??
        yearFromDateParts((item.issued as { "date-parts"?: unknown })?.["date-parts"]),
      venue: cleanText(
        Array.isArray(item["container-title"])
          ? item["container-title"][0]
          : item["container-title"],
        500,
      ),
      doi,
      url: doi ? `https://doi.org/${doi}` : cleanText(item.URL, 2_000),
      abstract: cleanText(item.abstract),
      provider: "crossref" as const,
      providerRecordId,
    }];
  });
}

function openAlexAbstract(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === "number") words.push([position, word]);
    }
  }
  words.sort((left, right) => left[0] - right[0]);
  return cleanText(words.map(([, word]) => word).join(" "));
}

function openAlexCandidates(payload: unknown): Candidate[] {
  const results = (payload as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const item = raw as Record<string, unknown>;
    const title = cleanText(item.title, 1_000);
    const authorships = Array.isArray(item.authorships) ? item.authorships : [];
    const authors = authorships.flatMap((rawAuthorship) => {
      const author = (rawAuthorship as { author?: { display_name?: unknown } }).author;
      const name = cleanText(author?.display_name, 300);
      return name ? [name] : [];
    });
    if (!title || authors.length === 0) return [];
    const doi = normalizeDoi(item.doi);
    const id = cleanText(item.id, 2_000);
    const primaryLocation = item.primary_location as
      | { source?: { display_name?: unknown }; landing_page_url?: unknown }
      | undefined;
    return [{
      title,
      authors,
      year: typeof item.publication_year === "number" ? item.publication_year : undefined,
      venue: cleanText(primaryLocation?.source?.display_name, 500),
      doi,
      url:
        doi
          ? `https://doi.org/${doi}`
          : cleanText(primaryLocation?.landing_page_url, 2_000) ?? id,
      abstract: openAlexAbstract(item.abstract_inverted_index),
      provider: "openalex" as const,
      providerRecordId: id ?? doi ?? title.slice(0, 120),
    }];
  });
}

async function fetchJson(
  fetcher: FetchLike,
  url: URL,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mergeCandidates(candidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, candidate);
      continue;
    }
    merged.set(key, {
      ...current,
      authors: current.authors.length >= candidate.authors.length
        ? current.authors
        : candidate.authors,
      year: current.year ?? candidate.year,
      venue: current.venue ?? candidate.venue,
      doi: current.doi ?? candidate.doi,
      url: current.url ?? candidate.url,
      abstract:
        (current.abstract?.length ?? 0) >= (candidate.abstract?.length ?? 0)
          ? current.abstract
          : candidate.abstract,
    });
  }
  return [...merged.values()];
}

function materializeCandidate(candidate: Candidate): ReferenceEvidence | undefined {
  const excerpt = cleanText(candidate.abstract);
  if (!excerpt || excerpt.length < 80) return undefined;
  const id = referenceId(candidate);
  const reference: VerifiedReference = {
    id,
    title: candidate.title,
    authors: candidate.authors.slice(0, 100),
    year: candidate.year,
    venue: candidate.venue,
    doi: candidate.doi,
    url: candidate.url,
    verifiedBy: "literature_service",
    sourceId: `${candidate.provider}-${createHash("sha256")
      .update(candidate.providerRecordId)
      .digest("hex")
      .slice(0, 24)}`,
  };
  return {
    evidenceId: id,
    reference,
    excerpt,
    locator: { section: "Abstract" },
  };
}

export async function acquireDocumentReferences(input: {
  profile: ReferenceExecutionProfile;
  topic: string;
  existingReferences: VerifiedReference[];
  existingEvidence: ReferenceEvidence[];
  fetcher?: FetchLike;
}): Promise<ReferencePipelineResult> {
  const startedAt = Date.now();
  if (!input.profile.enabled || input.profile.requirement === "forbidden") {
    return ReferencePipelineResultSchema.parse({
      status: "disabled",
      outcome: "unavailable",
      verifiedReferences: [],
      evidence: [],
      candidateCount: 0,
      relevanceRejectedCount: 0,
      providerCalls: 0,
      durationMs: Date.now() - startedAt,
      manifestRevision: 1,
      warnings: [],
    });
  }

  const useUserSources = input.profile.policy !== "web_search_only";
  const evidenceById = new Map(
    (useUserSources ? input.existingEvidence : []).map((item) => [
      item.evidenceId,
      item,
    ]),
  );
  const referenceById = new Map(
    (useUserSources ? input.existingReferences : []).map((item) => [
      item.id,
      item,
    ]),
  );
  const warnings: Array<{ code: string; message: string }> = [];
  let providerCalls = 0;
  let candidates: Candidate[] = [];

  if (input.profile.policy !== "user_sources_only") {
    const fetcher = input.fetcher ?? fetch;
    const crossrefUrl = new URL("https://api.crossref.org/works");
    crossrefUrl.searchParams.set("query.bibliographic", input.topic);
    crossrefUrl.searchParams.set("filter", "type:journal-article");
    crossrefUrl.searchParams.set("rows", String(MAX_REFERENCES));
    const contactEmail = process.env.RESEARCHGPT_CONTACT_EMAIL?.trim();
    if (contactEmail) crossrefUrl.searchParams.set("mailto", contactEmail);

    const openAlexUrl = new URL("https://api.openalex.org/works");
    openAlexUrl.searchParams.set("search", input.topic);
    openAlexUrl.searchParams.set("per-page", String(MAX_REFERENCES));
    const openAlexKey = process.env.OPENALEX_API_KEY?.trim();
    if (openAlexKey) openAlexUrl.searchParams.set("api_key", openAlexKey);

    const providers = await Promise.allSettled([
      fetchJson(fetcher, crossrefUrl),
      fetchJson(fetcher, openAlexUrl),
    ]);
    providerCalls = providers.length;
    if (providers[0].status === "fulfilled") {
      candidates.push(...crossrefCandidates(providers[0].value));
    } else {
      warnings.push({
        code: "crossref_unavailable",
        message: "Crossref检索暂时不可用，系统已继续使用其他来源。",
      });
    }
    if (providers[1].status === "fulfilled") {
      candidates.push(...openAlexCandidates(providers[1].value));
    } else {
      warnings.push({
        code: "openalex_unavailable",
        message: "OpenAlex检索暂时不可用，系统已继续使用其他来源。",
      });
    }
  }

  candidates = mergeCandidates(candidates);
  const candidateCount = candidates.length;
  const queryTerms = searchTerms(input.topic);
  candidates = candidates.filter((candidate) =>
    isRelevantCandidate(candidate, queryTerms),
  );
  const relevanceRejectedCount = candidateCount - candidates.length;
  if (relevanceRejectedCount > 0) {
    warnings.push({
      code: "references_off_topic_filtered",
      message: `已排除${relevanceRejectedCount}条与检索主题缺乏直接术语关联的候选文献。`,
    });
  }
  for (const candidate of candidates) {
    if (evidenceById.size >= MAX_REFERENCES) break;
    const evidence = materializeCandidate(candidate);
    if (!evidence || evidenceById.has(evidence.evidenceId)) continue;
    evidenceById.set(evidence.evidenceId, evidence);
    referenceById.set(evidence.reference.id, evidence.reference);
  }

  const evidence = [...evidenceById.values()].slice(0, MAX_REFERENCES);
  const allowedReferenceIds = new Set(evidence.map((item) => item.reference.id));
  const verifiedReferences = [...referenceById.values()].filter((reference) =>
    allowedReferenceIds.has(reference.id),
  );
  const outcome =
    evidence.length >= MIN_COMPLETE_REFERENCES
      ? "complete"
      : evidence.length > 0
        ? "partial"
        : "unavailable";
  if (outcome === "partial") {
    warnings.push({
      code: "references_partial",
      message: `仅获得${evidence.length}篇具有可用摘要证据的可信文献，文档将使用部分参考文献。`,
    });
  } else if (outcome === "unavailable") {
    warnings.push({
      code: "references_unavailable",
      message: "未获得可验证且具有可用证据的文献，为避免虚构引用，将交付无参考文献版本。",
    });
  }

  return ReferencePipelineResultSchema.parse({
    status: outcome,
    outcome,
    verifiedReferences,
    evidence,
    candidateCount,
    relevanceRejectedCount,
    providerCalls,
    durationMs: Date.now() - startedAt,
    manifestRevision: 1,
    warnings,
  });
}

export function createReferencePipelineFallback(input: {
  existingReferences: VerifiedReference[];
  existingEvidence: ReferenceEvidence[];
}): ReferencePipelineResult {
  const evidenceIds = new Set(
    input.existingEvidence.map((item) => item.reference.id),
  );
  const verifiedReferences = input.existingReferences.filter((reference) =>
    evidenceIds.has(reference.id),
  );
  const outcome = verifiedReferences.length > 0 ? "partial" : "unavailable";
  return ReferencePipelineResultSchema.parse({
    status: "failed",
    outcome,
    verifiedReferences,
    evidence: input.existingEvidence,
    candidateCount: 0,
    relevanceRejectedCount: 0,
    providerCalls: 0,
    durationMs: 0,
    manifestRevision: 1,
    warnings: [
      {
        code: "reference_pipeline_failed",
        message:
          outcome === "partial"
            ? "联网参考文献获取失败，文档将继续使用用户已提供的可信资料。"
            : "参考文献获取失败，为避免虚构引用，将交付无参考文献版本。",
      },
    ],
  });
}
