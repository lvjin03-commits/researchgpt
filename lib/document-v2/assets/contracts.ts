import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(120);

export const FigureRenderStrategySchema = z.enum([
  "deterministic_svg",
  "generative_raster_standard",
  "generative_raster_premium",
  // Compatibility value for jobs created before the tiered image policy.
  "textless_raster_overlay",
  "verified_data_plot",
]);

export const FigureTextRenderingModeSchema = z.enum([
  "native_deterministic",
  "program_overlay",
  "numbered_legend",
]);

export const FigureComplexityAssessmentSchema = z
  .object({
    topologyComplexity: z.number().int().min(0).max(10),
    spatialIllustrationRequired: z.boolean(),
    realisticMorphologyRequired: z.boolean(),
    dataDriven: z.boolean(),
    labelCount: z.number().int().min(0).max(24),
    deterministicRenderability: z.number().min(0).max(1),
  })
  .strict();

export const ImageProviderConfigSchema = z
  .object({
    provider: z.literal("openai"),
    requestedModelId: IdentifierSchema,
    resolvedModelId: IdentifierSchema,
    size: z.enum(["1024x1024", "1024x1536", "1536x1024"]),
    quality: z.enum(["low", "medium", "high"]),
    outputFormat: z.literal("png"),
    capabilityVersion: IdentifierSchema,
  })
  .strict();

export const ImageExecutionProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    standard: ImageProviderConfigSchema,
    premium: ImageProviderConfigSchema,
    premiumAuthorization: z
      .object({
        enabled: z.boolean(),
        maximumFigures: z.number().int().nonnegative(),
        maximumEstimatedCostUsd: z.number().nonnegative(),
      })
      .strict(),
    failurePolicy: z.enum([
      "deliver_without_failed_figures",
      "deliver_with_deterministic_fallback",
      "pause_before_delivery",
    ]),
    rateCardVersion: IdentifierSchema,
    frozenAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ImageExecutionProfile = z.infer<typeof ImageExecutionProfileSchema>;

export const FigureLabelSpecSchema = z
  .object({
    labelId: IdentifierSchema,
    text: z.string().trim().min(1).max(500),
    role: z.enum(["node", "edge", "callout", "legend", "axis", "annotation"]),
    anchorId: IdentifierSchema,
    preferredPlacement: z.enum([
      "inside",
      "above",
      "below",
      "left",
      "right",
      "auto",
    ]),
    maxLines: z.number().int().min(1).max(8).optional(),
    maxWidthRatio: z.number().positive().max(1).optional(),
    priority: z.enum(["required", "optional"]),
  })
  .strict();

export type FigureLabelSpec = z.infer<typeof FigureLabelSpecSchema>;

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
    questionAnswered: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .default("Explain the planned scientific relationship."),
    evidenceMode: z.enum(["verified", "conceptual"]).default("conceptual"),
    claimsRepresented: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(12)
      .default(["Conceptual relationship described by the figure."]),
    placementAfterBlockIndex: z.number().int().min(0).max(499),
    sourceEvidenceIds: z.array(IdentifierSchema).max(500),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.evidenceMode === "verified" &&
      request.sourceEvidenceIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceEvidenceIds"],
        message: "Verified figure requests require source evidence.",
      });
    }
    if (
      request.figureType === "data_plot" &&
      request.evidenceMode !== "verified"
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceMode"],
        message: "Data plots require verified evidence mode.",
      });
    }
  });

export type FigureRequestDraft = z.infer<typeof FigureRequestDraftSchema>;

export const FigureRequestSchema = FigureRequestDraftSchema.extend({
  requestId: IdentifierSchema,
  componentKey: IdentifierSchema,
  documentLanguage: z.enum(["zh", "en"]).optional(),
  renderStrategy: FigureRenderStrategySchema.optional(),
  textRenderingMode: FigureTextRenderingModeSchema.optional(),
  complexityAssessment: FigureComplexityAssessmentSchema.optional(),
  labels: z.array(FigureLabelSpecSchema).max(24).default([]),
})
  .strict()
  .superRefine((request, context) => {
    const labelIds = new Set<string>();
    request.labels.forEach((label, index) => {
      if (labelIds.has(label.labelId)) {
        context.addIssue({
          code: "custom",
          path: ["labels", index, "labelId"],
          message: "Figure label IDs must be unique.",
        });
      }
      labelIds.add(label.labelId);
      if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(label.text)) {
        context.addIssue({
          code: "custom",
          path: ["labels", index, "text"],
          message: "Figure labels cannot contain replacement or control characters.",
        });
      }
    });
  });

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
    preferredDisplayWidthMm: z.number().min(40).max(170).default(150),
    minimumReadableWidthMm: z.number().min(40).max(170).default(90),
    labelDensity: z.enum(["low", "medium", "high"]).default("medium"),
    preferredLayout: z
      .enum(["inline_medium", "inline_wide", "full_width", "dedicated_page"])
      .default("full_width"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    title: z.string().trim().min(1).max(500),
    altText: z.string().trim().min(1).max(1_000),
    provenance: z
      .object({
        renderStrategy: FigureRenderStrategySchema,
        textRenderingMode: FigureTextRenderingModeSchema.optional(),
        baseAssetProvider: z.string().trim().min(1).max(120).optional(),
        baseAssetFingerprint: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
        providerRequestId: z.string().trim().min(1).max(240).optional(),
        resolvedModel: z.string().trim().min(1).max(120).optional(),
        resolvedSize: z.string().trim().min(1).max(120).optional(),
        resolvedQuality: z.string().trim().min(1).max(120).optional(),
        cacheHit: z.boolean().optional(),
        estimatedCostUsd: z.number().nonnegative().optional(),
        costSource: z.enum(["provider_usage", "rate_card_estimate"]).optional(),
        rateCardVersion: z.string().trim().min(1).max(120).optional(),
        capabilityVersion: z.string().trim().min(1).max(120).optional(),
        labelRendererVersion: z.string().trim().min(1).max(120),
        fontPolicyVersion: z.string().trim().min(1).max(120),
        labelSpecHash: z.string().regex(/^[a-f0-9]{64}$/i),
        finalAssetHash: z.string().regex(/^[a-f0-9]{64}$/i),
      })
      .strict()
      .optional(),
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
    if (asset.minimumReadableWidthMm > asset.preferredDisplayWidthMm) {
      context.addIssue({
        code: "custom",
        path: ["minimumReadableWidthMm"],
        message: "Minimum readable width cannot exceed preferred width.",
      });
    }
    if (
      asset.provenance &&
      asset.provenance.finalAssetHash !== asset.sha256
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "finalAssetHash"],
        message: "Figure provenance must reference the published asset hash.",
      });
    }
  });

export type FigureAsset = z.infer<typeof FigureAssetSchema>;
