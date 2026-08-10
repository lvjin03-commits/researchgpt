import { z } from "zod";
import { GrantDocumentDraftSchema } from "../domain/contracts.ts";

export const GrantImportWarningSchema = z.object({
  code: z.enum([
    "header_not_editable",
    "footer_not_editable",
    "section_layout_simplified",
    "floating_object_not_imported",
    "floating_image_layout_simplified",
    "image_not_imported",
    "image_media_unsupported",
    "image_relationship_invalid",
    "image_part_missing",
    "field_not_imported",
    "comment_not_imported",
    "tracked_change_flattened",
    "footnote_not_imported",
    "endnote_not_imported",
    "formula_simplified",
    "parser_warning",
  ]),
  message: z.string().trim().min(1),
}).strict();

export const GrantDocxImportPreviewSchema = z.object({
  fileName: z.string().trim().min(1),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  draft: GrantDocumentDraftSchema,
  summary: z.object({
    sectionCount: z.number().int().positive(),
    paragraphCount: z.number().int().nonnegative(),
      listCount: z.number().int().nonnegative(),
      tableCount: z.number().int().nonnegative(),
      figureCount: z.number().int().nonnegative(),
  }).strict(),
  warnings: z.array(GrantImportWarningSchema),
}).strict();

export type GrantImportWarning = z.infer<typeof GrantImportWarningSchema>;
export type GrantDocxImportPreview = z.infer<typeof GrantDocxImportPreviewSchema>;
