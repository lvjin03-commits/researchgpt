import { z } from "zod";

export const GrantExportWarningSchema = z.object({
  code: z.enum(["figure_asset_unavailable", "citation_metadata_unavailable"]),
  nodeId: z.string().uuid(),
  message: z.string().trim().min(1),
}).strict();

export const GrantDocxArtifactSchema = z.object({
  fileName: z.string().trim().min(1).endsWith(".docx"),
  mimeType: z.literal("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevisionId: z.string().uuid(),
  warnings: z.array(GrantExportWarningSchema),
}).strict();

export type GrantExportWarning = z.infer<typeof GrantExportWarningSchema>;
export type GrantDocxArtifact = z.infer<typeof GrantDocxArtifactSchema> & { buffer: Buffer };
