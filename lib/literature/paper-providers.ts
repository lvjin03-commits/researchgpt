import type { LiteratureProviderId } from "@/lib/literature/providers/base";
import type { ArxivPaperDraft, LiteraturePaper } from "@/lib/literature/types";

export const PROVIDERS_CATEGORY_PREFIX = "providers:";
export const SOURCE_URLS_CATEGORY_PREFIX = "sourceUrls:";

export const LITERATURE_PROVIDER_BADGE_LABELS: Record<
  LiteratureProviderId,
  string
> = {
  openalex: "OpenAlex",
  arxiv: "arXiv",
  pubmed: "PubMed",
  crossref: "Crossref",
  dblp: "DBLP",
  openreview: "OpenReview",
  semantic_scholar: "Semantic Scholar",
};

export type PaperProviderMetadata = {
  providers: LiteratureProviderId[];
  sourceUrls: Partial<Record<LiteratureProviderId, string>>;
  displayCategories: string[];
};

export function embedPaperProviderMetadata(
  categories: string[],
  metadata: {
    providers?: LiteratureProviderId[];
    sourceUrls?: Partial<Record<LiteratureProviderId, string>>;
  },
): string[] {
  const displayCategories = categories.filter(
    (category) =>
      !category.startsWith(PROVIDERS_CATEGORY_PREFIX) &&
      !category.startsWith(SOURCE_URLS_CATEGORY_PREFIX),
  );

  const embedded = [...displayCategories];

  if (metadata.providers && metadata.providers.length > 0) {
    embedded.unshift(`${PROVIDERS_CATEGORY_PREFIX}${metadata.providers.join(",")}`);
  }

  if (metadata.sourceUrls && Object.keys(metadata.sourceUrls).length > 0) {
    embedded.unshift(
      `${SOURCE_URLS_CATEGORY_PREFIX}${JSON.stringify(metadata.sourceUrls)}`,
    );
  }

  return embedded;
}

export function extractPaperProviderMetadata(
  categories: string[],
): PaperProviderMetadata {
  const providers: LiteratureProviderId[] = [];
  let sourceUrls: Partial<Record<LiteratureProviderId, string>> = {};

  for (const category of categories) {
    if (category.startsWith(PROVIDERS_CATEGORY_PREFIX)) {
      const raw = category.slice(PROVIDERS_CATEGORY_PREFIX.length);
      for (const item of raw.split(",")) {
        const id = item.trim() as LiteratureProviderId;
        if (id && !providers.includes(id)) {
          providers.push(id);
        }
      }
      continue;
    }

    if (category.startsWith(SOURCE_URLS_CATEGORY_PREFIX)) {
      try {
        const parsed = JSON.parse(
          category.slice(SOURCE_URLS_CATEGORY_PREFIX.length),
        ) as Partial<Record<LiteratureProviderId, string>>;

        sourceUrls = { ...sourceUrls, ...parsed };
      } catch {
        // Ignore malformed metadata.
      }
    }
  }

  const displayCategories = categories.filter(
    (category) =>
      !category.startsWith(PROVIDERS_CATEGORY_PREFIX) &&
      !category.startsWith(SOURCE_URLS_CATEGORY_PREFIX),
  );

  return { providers, sourceUrls, displayCategories };
}

export function inferProvidersFromExternalKey(
  externalKey: string,
): LiteratureProviderId[] {
  if (externalKey.startsWith("pubmed:")) {
    return ["pubmed"];
  }

  if (externalKey.startsWith("openalex:")) {
    return ["openalex"];
  }

  if (externalKey.includes(":")) {
    const provider = externalKey.split(":")[0] as LiteratureProviderId;
    return [provider];
  }

  return ["arxiv"];
}

export function getPaperProviders(
  paper: Pick<LiteraturePaper, "arxivId" | "categories" | "providers">,
): LiteratureProviderId[] {
  if (paper.providers && paper.providers.length > 0) {
    return paper.providers;
  }

  const extracted = extractPaperProviderMetadata(paper.categories);
  if (extracted.providers.length > 0) {
    return extracted.providers;
  }

  return inferProvidersFromExternalKey(paper.arxivId);
}

export function getPaperSourceUrls(
  paper: Pick<
    LiteraturePaper,
    "arxivId" | "absUrl" | "categories" | "sourceUrls"
  >,
): Partial<Record<LiteratureProviderId, string>> {
  if (paper.sourceUrls && Object.keys(paper.sourceUrls).length > 0) {
    return paper.sourceUrls;
  }

  const extracted = extractPaperProviderMetadata(paper.categories);
  if (Object.keys(extracted.sourceUrls).length > 0) {
    return extracted.sourceUrls;
  }

  const providers = getPaperProviders(paper);
  const fallback: Partial<Record<LiteratureProviderId, string>> = {};

  for (const provider of providers) {
    fallback[provider] = paper.absUrl;
  }

  return fallback;
}

export function applyDraftProviderMetadata(
  draft: ArxivPaperDraft,
): ArxivPaperDraft {
  const categories = embedPaperProviderMetadata(draft.categories, {
    providers: draft.providers,
    sourceUrls: draft.sourceUrls,
  });

  return {
    ...draft,
    categories,
  };
}

export function resolvePaperProviderMetadata(
  paper: LiteraturePaper,
): LiteraturePaper {
  const extracted = extractPaperProviderMetadata(paper.categories);

  return {
    ...paper,
    providers:
      paper.providers && paper.providers.length > 0
        ? paper.providers
        : extracted.providers.length > 0
          ? extracted.providers
          : inferProvidersFromExternalKey(paper.arxivId),
    sourceUrls:
      paper.sourceUrls && Object.keys(paper.sourceUrls).length > 0
        ? paper.sourceUrls
        : extracted.sourceUrls,
    categories: extracted.displayCategories,
  };
}
