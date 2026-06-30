const URL_PATTERN = /^https?:\/\/\S+$/i;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;
const NUMBER_ONLY_PATTERN = /^[\d\s.,:%+\-–—/()]+$/;
const FIGURE_TABLE_LABEL_PATTERN =
  /^(figure|fig\.?|table|scheme|chart|appendix|section|chapter)\s+(\d+|[IVXLC]+)\b[.:\s-]*/i;
const BRACKET_CITATION_PATTERN = /^\[\d+(?:[-–,]\d+)*\]$/;
const PAREN_CITATION_PATTERN =
  /^\(?[A-Z][A-Za-z\-]+(?:\s+(?:et\s+al\.?|and\s+[A-Z][A-Za-z\-]+))?,?\s+\d{4}[a-z]?\)?\.?$/;
const REFERENCES_HEADING_PATTERN = /^references?$/i;

export function getSkipReason(text: string): string | null {
  const trimmed = text.trim();

  if (!trimmed) {
    return "empty";
  }

  if (URL_PATTERN.test(trimmed)) {
    return "url";
  }

  if (EMAIL_PATTERN.test(trimmed)) {
    return "email";
  }

  if (DOI_PATTERN.test(trimmed)) {
    return "doi";
  }

  if (NUMBER_ONLY_PATTERN.test(trimmed)) {
    return "number";
  }

  if (FIGURE_TABLE_LABEL_PATTERN.test(trimmed)) {
    return "figure-table-label";
  }

  if (BRACKET_CITATION_PATTERN.test(trimmed)) {
    return "citation-marker";
  }

  if (PAREN_CITATION_PATTERN.test(trimmed)) {
    return "citation-marker";
  }

  if (REFERENCES_HEADING_PATTERN.test(trimmed)) {
    return "reference-section";
  }

  return null;
}

export function shouldSkipTranslation(text: string): boolean {
  return getSkipReason(text) !== null;
}
