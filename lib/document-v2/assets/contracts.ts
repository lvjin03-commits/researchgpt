import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(120);

export const FigureRequestDraftSchema = z
  .object({
    slotId: IdentifierSchema.nullable().default(null),
    figureType: z.enum([
      "mechanism_diagram",
      "process_flow",
      "conceptual_framework",
      "comparison_diagram",
      "data_plot",
    ]),
    title: z.string().trim().min(1).max(500),
    caption: z.string().trim().min(1).max(2_000),
    altText: z.string().trim().min(1).max(1_000),
    contentBrief: z.string().trim().min(1).max(4_000),
    placementAfterBlockIndex: z.number().int().min(0).max(499),
    sourceEvidenceIds: z.array(IdentifierSchema).max(500),
  })
  .strict();

export type FigureRequestDraft = z.infer<typeof FigureRequestDraftSchema>;

export const FigureRequestSchema = FigureRequestDraftSchema.extend({
  requestId: IdentifierSchema,
  componentKey: IdentifierSchema,
}).strict();

export type FigureRequest = z.infer<typeof FigureRequestSchema>;

export const FigureAssetSchema = z
  .object({
    id: IdentifierSchema,
    requestId: IdentifierSchema,
    format: z.enum(["png", "svg"]),
    dataBase64: z.string().min(1).max(70_000_000).optional(),
    fallbackPngBase64: z.string().min(1).max(70_000_000).optional(),
    storageBucket: IdentifierSchema.optional(),
    storagePath: z.string().min(1).max(1_000).optional(),
    fallbackStoragePath: z.string().min(1).max(1_000).optional(),
    byteSize: z.number().int().positive().optional(),
    pixelWidth: z.number().int().min(1).max(100_000),
    pixelHeight: z.number().int().min(1).max(100_000),
    dpi: z.number().int().min(300).max(2_400),
    displayWidthPx: z.number().int().min(1).max(2_000),
    displayHeightPx: z.number().int().min(1).max(2_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    title: z.string().trim().min(1).max(500),
    altText: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((asset, context) => {
    if (!asset.dataBase64 && !(asset.storageBucket && asset.storagePath)) {
      context.addIssue({
        code: "custom",
        path: ["storagePath"],
        message: "Figure assets require inline data or a storage reference.",
      });
    }
    if (
      asset.format === "svg" &&
      !asset.fallbackPngBase64 &&
      !asset.fallbackStoragePath
    ) {
      context.addIssue({
        code: "custom",
        path: ["fallbackPngBase64"],
        message: "SVG assets require a PNG fallback for Word compatibility.",
      });
    }
    if (
      asset.format === "png" &&
      (asset.fallbackPngBase64 || asset.fallbackStoragePath)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fallbackPngBase64"],
        message: "PNG assets cannot define a separate PNG fallback.",
      });
    }
  });

export type FigureAsset = z.infer<typeof FigureAssetSchema>;
