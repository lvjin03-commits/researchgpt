const SEARCH_TERM_SEPARATORS = /[,\uFF0C;\uFF1B\n]+/u;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export function normalizeLiteratureSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseLiteratureKeywordEntries(keywords: string): string[] {
  return keywords
    .split(SEARCH_TERM_SEPARATORS)
    .map((value) => value.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function parseLiteratureKeywordTerms(keywords: string): string[] {
  const terms = new Set<string>();

  for (const entry of parseLiteratureKeywordEntries(keywords)) {
    terms.add(entry);

    const normalizedTokens = normalizeLiteratureSearchText(entry).split(" ");
    if (normalizedTokens.length > 1) {
      for (const token of normalizedTokens) {
        if (token.length >= 2 && !SEARCH_STOP_WORDS.has(token)) {
          terms.add(token);
        }
      }
    }
  }

  return [...terms].sort((left, right) => right.length - left.length);
}

export type LiteratureKeywordMatchRange = {
  start: number;
  end: number;
};

type NormalizedTextMap = {
  text: string;
  starts: number[];
  ends: number[];
};

function normalizeLiteratureSearchTextWithMap(value: string): NormalizedTextMap {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];

  for (let sourceStart = 0; sourceStart < value.length; ) {
    const codePoint = value.codePointAt(sourceStart);
    if (codePoint === undefined) {
      break;
    }

    const sourceCharacter = String.fromCodePoint(codePoint);
    const sourceEnd = sourceStart + sourceCharacter.length;
    const normalized = sourceCharacter.normalize("NFKC").toLowerCase();

    for (const normalizedCharacter of normalized) {
      const isWordCharacter = /[\p{L}\p{N}]/u.test(normalizedCharacter);
      const outputCharacter = isWordCharacter ? normalizedCharacter : " ";

      if (outputCharacter === " " && (text.length === 0 || text.endsWith(" "))) {
        continue;
      }

      for (let index = 0; index < outputCharacter.length; index += 1) {
        text += outputCharacter[index];
        starts.push(sourceStart);
        ends.push(sourceEnd);
      }
    }

    sourceStart = sourceEnd;
  }

  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }

  return { text, starts, ends };
}

export function findLiteratureKeywordMatchRanges(
  text: string,
  keywords: string,
): LiteratureKeywordMatchRange[] {
  const normalized = normalizeLiteratureSearchTextWithMap(text);
  const ranges: LiteratureKeywordMatchRange[] = [];

  for (const term of parseLiteratureKeywordTerms(keywords)) {
    const normalizedTerm = normalizeLiteratureSearchText(term);
    if (!normalizedTerm) {
      continue;
    }

    let searchFrom = 0;
    while (searchFrom < normalized.text.length) {
      const matchStart = normalized.text.indexOf(normalizedTerm, searchFrom);
      if (matchStart < 0) {
        break;
      }

      const matchEnd = matchStart + normalizedTerm.length;
      const isCjkTerm = CJK_PATTERN.test(normalizedTerm);
      const hasValidBoundaries =
        isCjkTerm ||
        ((matchStart === 0 || normalized.text[matchStart - 1] === " ") &&
          (matchEnd === normalized.text.length || normalized.text[matchEnd] === " "));

      if (hasValidBoundaries) {
        const sourceStart = normalized.starts[matchStart];
        const sourceEnd = normalized.ends[matchEnd - 1];
        const overlapsExisting = ranges.some(
          (range) => sourceStart < range.end && sourceEnd > range.start,
        );

        if (!overlapsExisting) {
          ranges.push({ start: sourceStart, end: sourceEnd });
        }
      }

      searchFrom = matchStart + Math.max(1, normalizedTerm.length);
    }
  }

  return ranges.sort((left, right) => left.start - right.start);
}

function includesNormalizedTerm(haystack: string, term: string): boolean {
  const normalizedTerm = normalizeLiteratureSearchText(term);
  if (!normalizedTerm) {
    return false;
  }

  if (CJK_PATTERN.test(normalizedTerm)) {
    return haystack.includes(normalizedTerm);
  }

  return ` ${haystack} `.includes(` ${normalizedTerm} `);
}

export function matchesLiteratureKeywords(
  title: string,
  abstract: string,
  keywords: string,
): boolean {
  const entries = parseLiteratureKeywordEntries(keywords);
  if (entries.length === 0) {
    return true;
  }

  const haystack = normalizeLiteratureSearchText(`${title} ${abstract}`);
  if (entries.some((entry) => includesNormalizedTerm(haystack, entry))) {
    return true;
  }

  if (entries.length > 1) {
    return false;
  }

  const tokens = parseLiteratureKeywordTerms(entries[0]).filter(
    (term) =>
      normalizeLiteratureSearchText(term) !==
      normalizeLiteratureSearchText(entries[0]),
  );
  if (tokens.length === 0) {
    return false;
  }

  const matchedTokens = tokens.filter((term) =>
    includesNormalizedTerm(haystack, term),
  ).length;
  const requiredMatches = Math.min(2, tokens.length);

  return matchedTokens >= requiredMatches;
}
