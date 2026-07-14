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
