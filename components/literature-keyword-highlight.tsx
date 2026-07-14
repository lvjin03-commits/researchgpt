import { Fragment, type ReactNode } from "react";
import { findLiteratureKeywordMatchRanges } from "@/lib/literature/search-keywords";

type LiteratureKeywordHighlightProps = {
  text: string;
  keywords?: string;
};

export function buildLiteratureKeywordSnippet(
  text: string,
  keywords: string,
  maxLength = 360,
): string {
  if (text.length <= maxLength) {
    return text;
  }

  const firstMatch = findLiteratureKeywordMatchRanges(text, keywords)[0];
  if (!firstMatch) {
    return `${text.slice(0, maxLength).trimEnd()}...`;
  }

  const preferredContextBefore = Math.floor(maxLength * 0.35);
  let start = Math.max(0, firstMatch.start - preferredContextBefore);
  let end = Math.min(text.length, start + maxLength);

  if (end === text.length) {
    start = Math.max(0, end - maxLength);
  }

  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace >= 0 && nextSpace < firstMatch.start) {
      start = nextSpace + 1;
    }
  }

  if (end < text.length) {
    const previousSpace = text.lastIndexOf(" ", end);
    if (previousSpace > firstMatch.end) {
      end = previousSpace;
    }
  }

  return `${start > 0 ? "..." : ""}${text.slice(start, end).trim()}${
    end < text.length ? "..." : ""
  }`;
}

export function LiteratureKeywordHighlight({
  text,
  keywords = "",
}: LiteratureKeywordHighlightProps) {
  const ranges = findLiteratureKeywordMatchRanges(text, keywords);
  if (ranges.length === 0) {
    return text;
  }

  const content: ReactNode[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      content.push(text.slice(cursor, range.start));
    }

    content.push(
      <mark
        key={`${range.start}-${range.end}`}
        className="rounded-sm bg-red-100 px-0.5 font-semibold !text-red-700"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
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
