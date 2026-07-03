// Server-only module.

import {
  fetchPaperCitationNetwork,
  SemanticScholarRateLimitError,
  SEMANTIC_SCHOLAR_RATE_LIMIT_MESSAGE,
} from "@/lib/literature/providers/semantic-scholar";
import {
  getCachedCitationNetwork,
  setCachedCitationNetwork,
} from "@/lib/literature/server/citation-network-cache";
import type { LiteraturePaper, PaperCitationNetwork } from "@/lib/literature/types";

function buildRateLimitedResponse(): PaperCitationNetwork {
  return {
    citationCount: null,
    referenceCount: null,
    influentialCitationCount: null,
    references: [],
    citations: [],
    relatedPapers: [],
    rateLimited: true,
    message: SEMANTIC_SCHOLAR_RATE_LIMIT_MESSAGE,
  };
}

export async function getPaperCitationNetwork(
  paper: LiteraturePaper,
): Promise<PaperCitationNetwork> {
  const cached = await getCachedCitationNetwork(paper.id);
  if (cached) {
    return cached;
  }

  try {
    const network = await fetchPaperCitationNetwork(paper);
    await setCachedCitationNetwork(paper.id, network);
    return network;
  } catch (error) {
    if (error instanceof SemanticScholarRateLimitError) {
      return buildRateLimitedResponse();
    }

    throw error;
  }
}
