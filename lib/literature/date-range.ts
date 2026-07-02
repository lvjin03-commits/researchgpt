import { LiteratureError } from "@/lib/literature/errors";
import {
  ALLOWED_LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_DATE_RANGE_DAYS,
  normalizeDateRangeDays,
} from "@/lib/literature/constants";
import type { LiteratureDateRangeDays } from "@/lib/literature/constants";

export function parseDateRangeDays(value: unknown): LiteratureDateRangeDays {
  if (value === undefined || value === null) {
    return LITERATURE_DATE_RANGE_DAYS;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new LiteratureError("Invalid date range.", 400);
  }

  const rounded = Math.round(value);

  if (rounded === 7) {
    return LITERATURE_DATE_RANGE_DAYS;
  }

  if (
    !ALLOWED_LITERATURE_DATE_RANGE_DAYS.includes(
      rounded as LiteratureDateRangeDays,
    )
  ) {
    throw new LiteratureError(
      "Date range must be 1 month, 1 year, 5 years, 10 years, or All time.",
      400,
    );
  }

  return rounded as LiteratureDateRangeDays;
}

export { normalizeDateRangeDays };
