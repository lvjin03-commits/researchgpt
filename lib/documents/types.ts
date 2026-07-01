// Server-only module. Do not import from client components or /api/chat route entry.

export type ParsedDocument = {
  fileName: string;
  text: string;
  truncated: boolean;
  originalLength: number;
};

export type PdfAttachmentResult =
  | { kind: "text"; document: ParsedDocument }
  | {
      kind: "scanned";
      fileName: string;
      images: { dataUrl: string }[];
      pageNote: string;
    };
