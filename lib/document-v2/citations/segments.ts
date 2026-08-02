const CJK_AT_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
const CJK_AT_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function citationSegmentSeparator(
  previousText: string,
  nextText: string,
): string {
  if (CJK_AT_END.test(previousText) || CJK_AT_START.test(nextText)) return "";
  return " ";
}

export function joinCitationSegmentTexts(
  segments: ReadonlyArray<{ text: string }>,
): string {
  return segments.reduce((text, segment, index) => {
    if (index === 0) return segment.text;
    return `${text}${citationSegmentSeparator(segments[index - 1].text, segment.text)}${segment.text}`;
  }, "");
}
