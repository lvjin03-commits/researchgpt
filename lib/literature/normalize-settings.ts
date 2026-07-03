import { DEFAULT_LITERATURE_DISCIPLINE } from "@/lib/literature/source-taxonomy";
import {
  DEFAULT_LITERATURE_PIPELINE_SOURCES,
} from "@/lib/literature/constants";
import { normalizeDateRangeDays } from "@/lib/literature/date-range";
import type { LiteratureSettings } from "@/lib/literature/types";

type StoredLiteratureSettings = Partial<LiteratureSettings> & {
  source?: string;
};

export function normalizeLiteratureSettings(
  raw: StoredLiteratureSettings,
): LiteratureSettings {
  const dateRangeDays = normalizeDateRangeDays(raw.dateRangeDays);

  return {
    researchDirection: raw.researchDirection ?? "",
    keywords: raw.keywords ?? "",
    excludeKeywords: raw.excludeKeywords ?? "",
    discipline: DEFAULT_LITERATURE_DISCIPLINE,
    selectedSources: [...DEFAULT_LITERATURE_PIPELINE_SOURCES],
    dateRangeDays,
  };
}
