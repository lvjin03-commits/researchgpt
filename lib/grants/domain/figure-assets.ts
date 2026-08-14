import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const LocalBlockKeySchema = z.string().trim().min(1).max(200);

export const GrantFigureMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/tiff",
  "image/bmp",
  "image/x-emf",
  "image/x-wmf",
]);

export const GrantFigureCaptionSchema = z.object({
  text: z.string().trim().min(1).max(4000).nullable(),
  source: z.enum(["word_caption", "adjacent_paragraph", "none"]),
}).strict().superRefine((caption, context) => {
  if ((caption.source === "none") !== (caption.text === null)) {
    context.addIssue({
      code: "custom",
      message: "A missing caption must use source=none; a detected caption must contain text.",
    });
  }
}).readonly();

export const GrantFigureImportAnchorSchema = z.object({
  sourceOrdinal: z.number().int().nonnegative(),
  relationshipId: z.string().trim().min(1).max(200),
  partName: z.string().trim().min(1).max(500),
  anchorKind: z.enum(["inline", "floating"]),
  sectionLocalKey: LocalBlockKeySchema.nullable(),
  precedingBlockLocalKey: LocalBlockKeySchema.nullable(),
  followingBlockLocalKey: LocalBlockKeySchema.nullable(),
  caption: GrantFigureCaptionSchema,
}).strict().readonly();

export const GrantImportedFigureAssetSchema = z.object({
  assetId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  sourceDocumentChecksum: Sha256Schema,
  contentHash: Sha256Schema,
  mediaType: GrantFigureMediaTypeSchema,
  byteSize: z.number().int().positive().max(50 * 1024 * 1024),
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
  storage: z.object({
    bucket: z.string().trim().min(1).max(200),
    path: z.string().trim().min(1).max(1000),
  }).strict(),
  anchor: GrantFigureImportAnchorSchema,
  createdAt: IsoTimestampSchema,
}).strict().readonly();

export const GrantImportedFigureAssetDraftSchema = GrantImportedFigureAssetSchema.unwrap().omit({
  documentId: true,
  sourceRevisionId: true,
  createdAt: true,
}).readonly();

export const GrantFigureModelPermissionsSchema = z.object({
  sendImageToModel: z.boolean(),
  useForSemanticDiagnosis: z.boolean(),
  useForAiEditing: z.boolean().default(false),
}).strict().superRefine((permissions, context) => {
  if ((permissions.useForSemanticDiagnosis || permissions.useForAiEditing) && !permissions.sendImageToModel) {
    context.addIssue({
      code: "custom",
      path: ["useForSemanticDiagnosis"],
      message: "Semantic diagnosis permission requires image transmission permission.",
    });
  }
}).readonly();

export const GrantFigureModelAuthorizationSchema = z.object({
  authorizationId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  authorizationRevision: z.number().int().positive(),
  allowedAssetIds: z.array(UuidSchema).min(1),
  permissions: GrantFigureModelPermissionsSchema,
  expiresAt: IsoTimestampSchema.nullable(),
  revokedAt: IsoTimestampSchema.nullable(),
  updatedBy: UuidSchema,
  updatedAt: IsoTimestampSchema,
}).strict().superRefine((authorization, context) => {
  if (new Set(authorization.allowedAssetIds).size !== authorization.allowedAssetIds.length) {
    context.addIssue({
      code: "custom",
      path: ["allowedAssetIds"],
      message: "Authorized figure asset IDs must be unique.",
    });
  }
}).readonly();

export type GrantFigureMediaType = z.infer<typeof GrantFigureMediaTypeSchema>;
export type GrantFigureCaption = z.infer<typeof GrantFigureCaptionSchema>;
export type GrantFigureImportAnchor = z.infer<typeof GrantFigureImportAnchorSchema>;
export type GrantImportedFigureAsset = z.infer<typeof GrantImportedFigureAssetSchema>;
export type GrantImportedFigureAssetDraft = z.infer<typeof GrantImportedFigureAssetDraftSchema>;
export type GrantFigureModelPermissions = z.infer<typeof GrantFigureModelPermissionsSchema>;
export type GrantFigureModelAuthorization = z.infer<typeof GrantFigureModelAuthorizationSchema>;

export const DEFAULT_GRANT_FIGURE_MODEL_PERMISSIONS: GrantFigureModelPermissions = {
  sendImageToModel: false,
  useForSemanticDiagnosis: false,
  useForAiEditing: false,
};
