import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const GrantEvidencePermissionsSchema = z.object({
  read: z.boolean(),
  index: z.boolean(),
  sendRelevantExcerptToModel: z.boolean(),
  useForReasoning: z.boolean(),
  useForCitation: z.boolean(),
}).strict().superRefine((permissions, context) => {
  const advanced = permissions.sendRelevantExcerptToModel
    || permissions.useForReasoning
    || permissions.useForCitation;
  if (advanced && (!permissions.read || !permissions.index)) {
    context.addIssue({
      code: "custom",
      message: "Model, reasoning and citation permissions require read and index permission.",
    });
  }
  if (permissions.useForReasoning && !permissions.sendRelevantExcerptToModel) {
    context.addIssue({
      code: "custom",
      path: ["useForReasoning"],
      message: "Reasoning permission requires model excerpt permission.",
    });
  }
}).readonly();

export const GrantEvidenceSourceSchema = z.object({
  sourceId: UuidSchema,
  documentId: UuidSchema,
  title: z.string().trim().min(1).max(500),
  fileName: z.string().trim().min(1).max(500),
  mediaType: z.string().trim().min(1).max(200),
  byteSize: z.number().int().positive().max(20 * 1024 * 1024),
  contentHash: Sha256Schema,
  provenanceType: z.enum(["published_literature", "own_unpublished_work", "project_material"]),
  sensitivity: z.enum(["public", "project_confidential", "unpublished_research", "highly_sensitive"]),
  status: z.enum(["active", "revoked", "deletion_pending", "deleted"]),
  storage: z.object({ bucket: z.string().min(1), path: z.string().min(1) }).strict().optional(),
  extraction: z.object({
    originalLength: z.number().int().nonnegative(),
    truncated: z.boolean(),
    cardCount: z.number().int().nonnegative(),
  }).strict(),
  createdBy: UuidSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  revokedAt: IsoTimestampSchema.optional(),
  deletedAt: IsoTimestampSchema.optional(),
}).strict().readonly();

export const GrantEvidenceCardSchema = z.object({
  cardId: UuidSchema,
  documentId: UuidSchema,
  sourceId: UuidSchema,
  order: z.number().int().nonnegative(),
  excerpt: z.string().trim().min(1).max(4000),
  excerptHash: Sha256Schema,
  locator: z.object({
    kind: z.literal("text_chunk"),
    chunkIndex: z.number().int().nonnegative(),
  }).strict(),
  status: z.enum(["active", "revoked"]),
  createdAt: IsoTimestampSchema,
}).strict().readonly();

export const GrantEvidenceAuthorizationSchema = z.object({
  authorizationId: UuidSchema,
  documentId: UuidSchema,
  sourceId: UuidSchema,
  revision: z.number().int().positive(),
  permissions: GrantEvidencePermissionsSchema,
  allowedTaskIds: z.array(UuidSchema).optional(),
  expiresAt: IsoTimestampSchema.optional(),
  revokedAt: IsoTimestampSchema.optional(),
  updatedBy: UuidSchema,
  updatedAt: IsoTimestampSchema,
}).strict().readonly();

export const GrantEvidenceDependencySchema = z.object({
  dependencyId: UuidSchema,
  documentId: UuidSchema,
  sourceId: UuidSchema,
  dependentKind: z.enum(["queued_model_call", "context_cache", "patch_proposal"]),
  dependentId: UuidSchema,
  status: z.enum(["active", "consumed", "evidence_revoked"]),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict().readonly();

export const GrantEvidenceResourceSchema = z.object({
  source: GrantEvidenceSourceSchema,
  authorization: GrantEvidenceAuthorizationSchema,
  cards: z.array(GrantEvidenceCardSchema),
}).strict().readonly();

export const GrantEvidenceResourceListSchema = z.array(GrantEvidenceResourceSchema);

export type GrantEvidencePermissions = z.infer<typeof GrantEvidencePermissionsSchema>;
export type GrantEvidenceSource = z.infer<typeof GrantEvidenceSourceSchema>;
export type GrantEvidenceCard = z.infer<typeof GrantEvidenceCardSchema>;
export type GrantEvidenceAuthorization = z.infer<typeof GrantEvidenceAuthorizationSchema>;
export type GrantEvidenceDependency = z.infer<typeof GrantEvidenceDependencySchema>;
export type GrantEvidenceResource = z.infer<typeof GrantEvidenceResourceSchema>;

export const DEFAULT_GRANT_EVIDENCE_PERMISSIONS: GrantEvidencePermissions = {
  read: true,
  index: true,
  sendRelevantExcerptToModel: false,
  useForReasoning: false,
  useForCitation: false,
};
