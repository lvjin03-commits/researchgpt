import { Fragment, type ReactNode } from "react";
import { findLiteratureKeywordMatchRanges } from "@/lib/literature/search-keywords";

type LiteratureKeywordHighlightProps = {
  text: string;
  keywords?: string;
};

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
