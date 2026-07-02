import {
  DEFAULT_LITERATURE_DISCIPLINE,
  getDefaultSelectedSources,
  isValidDisciplineId,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import type { LiteratureSettings } from "@/lib/literature/types";

type StoredLiteratureSettings = Partial<LiteratureSettings> & {
  source?: string;
};

export function normalizeLiteratureSettings(
  raw: StoredLiteratureSettings,
): LiteratureSettings {
  const discipline: LiteratureDisciplineId = isValidDisciplineId(
    String(raw.discipline ?? ""),
  )
    ? raw.discipline!
    : DEFAULT_LITERATURE_DISCIPLINE;

  let selectedSources = Array.isArray(raw.selectedSources)
    ? raw.selectedSources.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      )
    : [];

  if (selectedSources.length === 0 && raw.source === "arxiv") {
    selectedSources = ["arxiv"];
  }

  if (selectedSources.length === 0) {
    selectedSources = getDefaultSelectedSources(discipline);
  }

  const dateRangeDays =
    typeof raw.dateRangeDays === "number" && Number.isFinite(raw.dateRangeDays)
      ? Math.max(1, Math.min(30, Math.round(raw.dateRangeDays)))
      : 7;

  return {
    researchDirection: raw.researchDirection ?? "",
    keywords: raw.keywords ?? "",
    excludeKeywords: raw.excludeKeywords ?? "",
    discipline,
    selectedSources: [...new Set(selectedSources)],
    dateRangeDays,
  };
}
