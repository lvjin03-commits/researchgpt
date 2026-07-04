// Server-only module.

import type { LiteratureProvider, LiteratureProviderId } from "@/lib/literature/providers/base";

function createPlaceholderProvider(
  id: LiteratureProviderId,
  name: string,
): LiteratureProvider {
  return {
    id,
    name,
    enabled: false,

    async searchPapers() {
      return [];
    },

    async getPaper() {
      return null;
    },

    normalizePaper() {
      throw new Error(`${name} provider is not implemented yet.`);
    },
  };
}

export const openReviewProvider = createPlaceholderProvider(
  "openreview",
  "OpenReview",
);
export const semanticScholarSearchProvider = createPlaceholderProvider(
  "semantic_scholar",
  "Semantic Scholar",
);

/** Reserved providers — not yet wired into the search pipeline. */
export const FUTURE_LITERATURE_PROVIDERS: LiteratureProvider[] = [
  openReviewProvider,
  semanticScholarSearchProvider,
];
