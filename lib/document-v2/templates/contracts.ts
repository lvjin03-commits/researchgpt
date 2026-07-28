import { z } from "zod";
import { ResolvedTemplateSnapshotSchema } from "../contracts";

const IdentifierSchema = z.string().min(1).max(120);

export const TemplateComponentBlueprintSchema = z
  .object({
    componentKey: IdentifierSchema,
    type: z.enum([
      "title",
      "abstract",
      "keywords",
      "section",
      "conclusion",
      "reference_list",
    ]),
    required: z.boolean(),
    repeatable: z.boolean(),
    minimumCount: z.number().int().min(0).max(100),
    maximumCount: z.number().int().min(1).max(100),
    purpose: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((component, context) => {
    if (component.minimumCount > component.maximumCount) {
      context.addIssue({
        code: "custom",
        path: ["minimumCount"],
        message: "Minimum component count cannot exceed maximum count.",
      });
    }
    if (!component.repeatable && component.maximumCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["maximumCount"],
        message: "Non-repeatable components must have a maximum count of one.",
      });
    }
    if (component.required && component.minimumCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["minimumCount"],
        message: "Required components need a minimum count of at least one.",
      });
    }
  });

export type TemplateComponentBlueprint = z.infer<
  typeof TemplateComponentBlueprintSchema
>;

export const TemplateComponentBlueprintListSchema = z
  .array(TemplateComponentBlueprintSchema)
  .min(1)
  .superRefine((components, context) => {
    const keys = new Set<string>();
    components.forEach((component, index) => {
      if (keys.has(component.componentKey)) {
        context.addIssue({
          code: "custom",
          path: [index, "componentKey"],
          message: "Template component keys must be unique.",
        });
      }
      keys.add(component.componentKey);
    });
    const titles = components.filter((component) => component.type === "title");
    if (titles.length !== 1 || components[0]?.type !== "title") {
      context.addIssue({
        code: "custom",
        path: [0],
        message:
          "Template must contain exactly one title blueprint in first position.",
      });
    }
    const references = components.filter(
      (component) => component.type === "reference_list",
    );
    if (
      references.length !== 1 ||
      components.at(-1)?.type !== "reference_list"
    ) {
      context.addIssue({
        code: "custom",
        path: [components.length - 1],
        message:
          "Template must contain exactly one reference-list blueprint in final position.",
      });
    }
  });

export const AiResponsibilitySchema = z.enum([
  "title_content",
  "subtitle_decision",
  "abstract_content",
  "keyword_selection",
  "section_names",
  "section_order",
  "section_count",
  "section_content",
  "section_length",
  "paragraph_organization",
  "transitions",
  "terminology_consistency",
  "abbreviation_definition",
  "redundancy_reduction",
  "logical_order",
  "discussion_decision",
  "limitations_decision",
  "future_perspective_decision",
  "conclusion_content",
  "figure_need",
  "figure_type",
  "figure_content",
  "figure_caption",
  "figure_placement",
  "table_need",
  "table_content",
  "table_caption",
  "table_placement",
  "citation_placement",
  "citation_mapping",
  "figure_cross_reference",
  "table_cross_reference",
  "reference_order",
  "language_polish",
  "sentence_variety",
  "academic_tone",
  "content_completeness",
  "context_consistency",
  "figure_text_consistency",
  "reference_consistency",
]);

export type AiResponsibility = z.infer<typeof AiResponsibilitySchema>;

export const TemplateSnapshotSeedSchema =
  ResolvedTemplateSnapshotSchema.omit({ checksum: true });

export type TemplateSnapshotSeed = z.infer<typeof TemplateSnapshotSeedSchema>;

export const DocumentTemplateDefinitionSchema = z
  .object({
    templateId: IdentifierSchema,
    templateVersion: z.string().min(1).max(40),
    status: z.enum(["active", "planned", "retired"]),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    documentType: z.literal("sci_review"),
    supportedLanguages: z.array(z.enum(["zh", "en"])).min(1),
    supportedFormats: z.tuple([z.literal("docx")]),
    matchProfile: z
      .object({
        suitableFor: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
        unsuitableFor: z
          .array(z.string().trim().min(1).max(300))
          .max(30),
      })
      .strict(),
    componentBlueprints: TemplateComponentBlueprintListSchema,
    aiResponsibilities: z.array(AiResponsibilitySchema).min(1),
    fixedRulesDocument: z.string().trim().min(1).max(300),
    snapshotSeed: TemplateSnapshotSeedSchema,
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.snapshotSeed.templateId !== definition.templateId) {
      context.addIssue({
        code: "custom",
        path: ["snapshotSeed", "templateId"],
        message: "Snapshot seed template ID must match the definition.",
      });
    }
    if (
      definition.snapshotSeed.templateVersion !== definition.templateVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshotSeed", "templateVersion"],
        message: "Snapshot seed version must match the definition.",
      });
    }
    if (definition.snapshotSeed.origin.kind !== "system") {
      context.addIssue({
        code: "custom",
        path: ["snapshotSeed", "origin"],
        message: "Registry templates must have system origin.",
      });
    }
  });

export type DocumentTemplateDefinition = z.infer<
  typeof DocumentTemplateDefinitionSchema
>;

export const TemplateCandidateSchema = z
  .object({
    templateId: IdentifierSchema,
    templateVersion: z.string().min(1).max(40),
    displayName: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2_000),
    suitableFor: z.array(z.string().trim().min(1).max(300)),
    unsuitableFor: z.array(z.string().trim().min(1).max(300)),
  })
  .strict();

export type TemplateCandidate = z.infer<typeof TemplateCandidateSchema>;

export const TemplateMatchDecisionSchema = z
  .object({
    templateId: IdentifierSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type TemplateMatchDecision = z.infer<
  typeof TemplateMatchDecisionSchema
>;

export const UserTemplateAnalysisSchema = z
  .object({
    analysisVersion: z.string().min(1).max(40),
    displayName: z.string().trim().min(1).max(200),
    documentType: z.literal("sci_review"),
    language: z.enum(["zh", "en"]),
    typography: TemplateSnapshotSeedSchema.shape.typography,
    layout: TemplateSnapshotSeedSchema.shape.layout,
    rules: TemplateSnapshotSeedSchema.shape.rules,
    componentBlueprints: TemplateComponentBlueprintListSchema,
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict();

export type UserTemplateAnalysis = z.infer<
  typeof UserTemplateAnalysisSchema
>;

export const TemplateResolutionSchema = z
  .object({
    source: z.enum(["system_registry", "user_upload"]),
    snapshot: ResolvedTemplateSnapshotSchema,
    componentBlueprints: z.array(TemplateComponentBlueprintSchema).min(1),
    aiResponsibilities: z.array(AiResponsibilitySchema).min(1),
    warnings: z.array(z.string().trim().min(1).max(1_000)),
    selection: z
      .object({
        confidence: z.number().min(0).max(1).optional(),
        rationale: z.string().trim().min(1).max(1_000),
      })
      .strict(),
  })
  .strict();

export type TemplateResolution = z.infer<typeof TemplateResolutionSchema>;
