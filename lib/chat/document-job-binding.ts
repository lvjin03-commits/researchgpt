const DOCUMENT_JOB_MARKER_PATTERN =
  /\[\[RESEARCHGPT_DOCUMENT_JOB:([^\]]+)\]\]/g;

export function extractDocumentJobId(content: string): string | undefined {
  const matches = [...content.matchAll(DOCUMENT_JOB_MARKER_PATTERN)];
  const value = matches.at(-1)?.[1]?.trim();
  return value || undefined;
}

export function bindDocumentJobMarker(content: string, jobId: string): string {
  const withoutOldBinding = content
    .replace(DOCUMENT_JOB_MARKER_PATTERN, "")
    .trimEnd();
  return `${withoutOldBinding}${withoutOldBinding ? "\n\n" : ""}[[RESEARCHGPT_DOCUMENT_JOB:${jobId}]]`;
}
