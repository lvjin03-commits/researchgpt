import {
  DEFAULT_LITERATURE_DISCIPLINE,
  getDefaultSelectedSources,
  getDisciplineSources,
  isSourceAvailable,
  isValidDisciplineId,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import { normalizeDateRangeDays } from "@/lib/literature/date-range";
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

  const disciplineSourceIds = new Set(
    getDisciplineSources(discipline).map((source) => source.id),
  );
  selectedSources = selectedSources.filter((sourceId) =>
    disciplineSourceIds.has(sourceId),
  );

  if (selectedSources.length === 0) {
    selectedSources = getDefaultSelectedSources(discipline);
  }

  selectedSources = selectedSources.filter((sourceId) => isSourceAvailable(sourceId));

  if (selectedSources.length === 0) {
    selectedSources = getDefaultSelectedSources(discipline);
  }

  const dateRangeDays = normalizeDateRangeDays(raw.dateRangeDays);

  return {
    researchDirection: raw.researchDirection ?? "",
    keywords: raw.keywords ?? "",
    excludeKeywords: raw.excludeKeywords ?? "",
    discipline,
    selectedSources: [...new Set(selectedSources)],
    dateRangeDays,
  };
}
