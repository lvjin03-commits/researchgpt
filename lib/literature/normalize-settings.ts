import { DEFAULT_LITERATURE_DISCIPLINE } from "@/lib/literature/source-taxonomy";
import {
  DEFAULT_LITERATURE_PIPELINE_SOURCES,
} from "@/lib/literature/constants";
import { normalizeDateRangeDays } from "@/lib/literature/date-range";
import { isValidDisciplineId } from "@/lib/literature/source-taxonomy";
import type { LiteratureSettings } from "@/lib/literature/types";

type StoredLiteratureSettings = Partial<LiteratureSettings> & {
  source?: string;
};

export function normalizeLiteratureSettings(
  raw: StoredLiteratureSettings,
): LiteratureSettings {
  const dateRangeDays = normalizeDateRangeDays(raw.dateRangeDays);
  const discipline =
    raw.discipline && isValidDisciplineId(raw.discipline)
      ? raw.discipline
      : DEFAULT_LITERATURE_DISCIPLINE;
  const defaultSources = [...DEFAULT_LITERATURE_PIPELINE_SOURCES];
  const allowedSources = new Set<string>(defaultSources);
  const selectedSources =
    raw.selectedSources && raw.selectedSources.length > 0
      ? raw.selectedSources.filter((source) => allowedSources.has(source))
      : defaultSources;

  return {
    researchDirection: raw.researchDirection ?? "",
    keywords: raw.keywords ?? "",
    excludeKeywords: raw.excludeKeywords ?? "",
    discipline,
    selectedSources:
      selectedSources.length > 0 ? [...new Set(selectedSources)] : defaultSources,
    dateRangeDays,
  };
}
