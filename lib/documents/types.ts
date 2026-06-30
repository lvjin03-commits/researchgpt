// Server-only module. Do not import from client components or /api/chat route entry.

export type ParsedDocument = {
  fileName: string;
  text: string;
  truncated: boolean;
  originalLength: number;
};
