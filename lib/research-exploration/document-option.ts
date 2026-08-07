import { z } from "zod";

export const DocumentResearchModeSchema = z.enum(["fast", "enhanced"]);

export type DocumentResearchMode = z.infer<typeof DocumentResearchModeSchema>;

export function parseDocumentResearchMode(value: unknown): DocumentResearchMode {
  return DocumentResearchModeSchema.catch("fast").parse(value);
}
