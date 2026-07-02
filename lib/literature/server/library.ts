// Server-only module.

import { LiteratureError } from "@/lib/literature/errors";
import {
  filterLibraryPapers,
  type LibraryFilters,
  type LibraryStatusTab,
} from "@/lib/literature/library-filters";
import { isValidDisciplineId } from "@/lib/literature/source-taxonomy";

const LIBRARY_STATUS_VALUES = new Set<LibraryStatusTab>([
  "saved",
  "read",
  "skipped",
  "all",
]);

const LIBRARY_PRIORITY_VALUES = new Set([
  "",
  "recommended",
  "skim",
  "skip",
]);

const LIBRARY_SOURCE_VALUES = new Set(["", "arxiv", "pubmed"]);

export function parseLibraryFilters(searchParams: URLSearchParams): LibraryFilters {
  const statusInput = searchParams.get("status")?.trim() ?? "saved";
  const status = LIBRARY_STATUS_VALUES.has(statusInput as LibraryStatusTab)
    ? (statusInput as LibraryStatusTab)
    : "saved";

  const source = searchParams.get("source")?.trim() ?? "";
  if (!LIBRARY_SOURCE_VALUES.has(source)) {
    throw new LiteratureError('Invalid source filter. Use "arxiv" or "pubmed".', 400);
  }

  const discipline = searchParams.get("discipline")?.trim() ?? "";
  if (discipline && !isValidDisciplineId(discipline)) {
    throw new LiteratureError("Invalid discipline filter.", 400);
  }

  const priority = searchParams.get("priority")?.trim() ?? "";
  if (!LIBRARY_PRIORITY_VALUES.has(priority)) {
    throw new LiteratureError("Invalid priority filter.", 400);
  }

  return {
    status,
    q: searchParams.get("q")?.trim() ?? "",
    source,
    discipline,
    priority,
    folderId: searchParams.get("folderId")?.trim() ?? "",
  };
}

export { filterLibraryPapers };
