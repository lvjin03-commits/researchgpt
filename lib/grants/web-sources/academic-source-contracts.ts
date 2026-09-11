import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const TimestampSchema = z.string().datetime({ offset: true });
const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const GrantAcademicEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("abstract"), text: z.string().trim().min(1).max(20_000) }).strict(),
  z.object({ kind: z.literal("metadata_only"), text: z.null() }).strict(),
]);

export const GrantAcademicSourceRecordSchema = z.object({
  schemaVersion: z.literal(2),
  sourceId: UuidSchema,
  providerId: z.literal("openalex"),
  providerRecordId: z.string().regex(/^W\d+$/u),
  canonicalUrl: z.string().url().max(3000),
  title: z.string().trim().min(1).max(500),
  evidence: GrantAcademicEvidenceSchema,
  publication: z.object({
    publicationYear: z.number().int().min(1600).max(2200).nullable(),
    publicationDate: IsoDateSchema.nullable(),
    doi: z.string().url().startsWith("https://doi.org/").max(1000).nullable(),
    venue: z.string().trim().min(1).max(500).nullable(),
    authors: z.array(z.string().trim().min(1).max(300)).max(100),
  }).strict(),
  retracted: z.literal(false),
  retrievedAt: TimestampSchema,
  contentFingerprint: Sha256Schema,
  classification: z.object({
    qualityTier: z.literal("academic_database"),
    registryVersion: z.string().trim().min(1).max(50),
    ruleId: z.string().trim().min(1).max(100),
    reason: z.literal("domain_rule"),
  }).strict(),
}).strict();

export type GrantAcademicSourceRecord = z.infer<typeof GrantAcademicSourceRecordSchema>;

