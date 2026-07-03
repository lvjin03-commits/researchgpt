// Server-only module.

import { searchLiteratureProviders } from "@/lib/literature/providers/index";
import type { ArxivPaperDraft, LiteratureSettings } from "@/lib/literature/types";

export async function fetchPapersFromSelectedSources(
  settings: LiteratureSettings,
): Promise<ArxivPaperDraft[]> {
  return searchLiteratureProviders(settings);
}
