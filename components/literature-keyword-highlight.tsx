import { Fragment, type ReactNode } from "react";
import { parseLiteratureKeywordTerms } from "@/lib/literature/search-keywords";

type LiteratureKeywordHighlightProps = {
  text: string;
  keywords?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function buildHighlightPattern(terms: string[]): RegExp | null {
  if (terms.length === 0) {
    return null;
  }

  const alternatives = terms.map((term) => {
    const escaped = escapeRegExp(term).replace(/\s+/g, "\\s+");

    return containsCjk(term)
      ? escaped
      : `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`;
  });

  return new RegExp(alternatives.join("|"), "giu");
}

export function LiteratureKeywordHighlight({
  text,
  keywords = "",
}: LiteratureKeywordHighlightProps) {
  const pattern = buildHighlightPattern(
    parseLiteratureKeywordTerms(keywords),
  );

  if (!pattern) {
    return text;
  }

  const content: ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) {
      content.push(text.slice(cursor, index));
    }

    content.push(
      <mark
        key={`${index}-${match[0]}`}
        className="rounded-sm bg-red-50 px-0.5 font-semibold text-red-700"
      >
        {match[0]}
      </mark>,
    );
    cursor = index + match[0].length;
  }

  if (cursor === 0) {
    return text;
  }

  if (cursor < text.length) {
    content.push(text.slice(cursor));
  }

  return (
    <>
      {content.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
