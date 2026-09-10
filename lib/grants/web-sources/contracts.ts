import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

// Google is retained only so immutable records created before ADR 0050 remain
// readable. The active provider port accepts OpenAI web search only.
export const GrantPersistedWebProviderIdSchema = z.enum([
  "openalex",
  "google_custom_search",
  "openai_web_search",
]);

export const GrantWebSourceQualityTierSchema = z.enum([
  "academic_database",
  "official_institution",
  "university_research",
  "general_web",
  "low_trust",
]);

export const GrantWebSourceRecordSchema = z.object({
  schemaVersion: z.literal(1),
  sourceId: UuidSchema,
  providerId: GrantPersistedWebProviderIdSchema,
  providerRecordId: z.string().trim().min(1).max(500).nullable(),
  canonicalUrl: z.string().url().max(3000),
  title: z.string().trim().min(1).max(500),
  snippet: z.string().trim().min(1).max(1200),
  publishedAt: TimestampSchema.nullable(),
  retrievedAt: TimestampSchema,
  contentFingerprint: Sha256Schema,
  classification: z.object({
    qualityTier: GrantWebSourceQualityTierSchema,
    registryVersion: z.string().trim().min(1).max(50),
    ruleId: z.string().trim().min(1).max(100).nullable(),
    reason: z.enum(["domain_rule", "unknown_domain"]),
  }).strict(),
}).strict();

export const GrantWebPublicSourceSnapshotSchema = GrantWebSourceRecordSchema.omit({
  sourceId: true,
  retrievedAt: true,
}).strict();

export const GrantWebSourceUsageEventSchema = z.object({
  usageEventId: UuidSchema,
  documentId: UuidSchema,
  assistantSessionId: UuidSchema.nullable(),
  turnId: UuidSchema,
  searchAuditId: UuidSchema,
  sourceId: UuidSchema,
  contentFingerprint: Sha256Schema,
  eventType: z.enum(["retrieved", "recommended", "excluded", "cited"]),
  createdAt: TimestampSchema,
}).strict();

// Model output intentionally contains IDs and relevance only. Source metadata,
// trust classification and registry version are program-owned.
export const GrantWebSourceAssessmentSchema = z.object({
  sourceId: UuidSchema,
  disposition: z.enum(["recommended", "excluded"]),
  reason: z.string().trim().min(1).max(500),
}).strict();

export const GrantWebQueryRewriteProposalSchema = z.object({
  query: z.string().trim().min(2).max(160),
}).strict();

export const GrantWebGroundedClaimSchema = z.object({
  claimId: UuidSchema,
  statement: z.string().trim().min(1).max(2000),
  sourceIds: z.array(UuidSchema).min(1).max(5),
}).strict();

export const GrantWebSynthesisProposalSchema = z.object({
  assessments: z.array(GrantWebSourceAssessmentSchema).max(10),
  claims: z.array(GrantWebGroundedClaimSchema).max(20),
}).strict();

export const GrantWebSourceAssessmentProposalSchema = z.object({
  assessments: z.array(GrantWebSourceAssessmentSchema).max(10),
}).strict();

export const GrantWebAnswerProposalSchema = z.object({
  claims: z.array(GrantWebGroundedClaimSchema).max(20),
}).strict();

export function validateGrantWebSourceAssessments(input: {
  proposal: unknown;
  sources: readonly GrantWebSourceRecord[];
}) {
  const proposal = GrantWebSourceAssessmentProposalSchema.parse(input.proposal);
  const current = new Map(input.sources.map((source) => [source.sourceId, source]));
  if (current.size !== input.sources.length) throw new Error("Current web source IDs must be unique.");
  const assessmentIds = proposal.assessments.map((item) => item.sourceId);
  if (new Set(assessmentIds).size !== assessmentIds.length) throw new Error("A web source may be assessed only once.");
  if (assessmentIds.length !== current.size || assessmentIds.some((id) => !current.has(id))) {
    throw new Error("Every current web source must be assessed exactly once.");
  }
  for (const assessment of proposal.assessments) {
    if (assessment.disposition === "recommended" && current.get(assessment.sourceId)?.classification.qualityTier === "low_trust") {
      throw new Error("Low-trust web sources cannot be recommended by model assessment.");
    }
  }
  return proposal.assessments;
}

export function validateGrantWebSynthesisProposal(input: {
  proposal: unknown;
  currentSourceIds: readonly string[];
}) {
  const proposal = GrantWebSynthesisProposalSchema.parse(input.proposal);
  const current = new Set(input.currentSourceIds);
  if (current.size !== input.currentSourceIds.length) throw new Error("Current web source IDs must be unique.");
  const assessmentIds = proposal.assessments.map((item) => item.sourceId);
  if (new Set(assessmentIds).size !== assessmentIds.length) throw new Error("A web source may be assessed only once.");
  for (const id of assessmentIds) if (!current.has(id)) throw new Error("Assessment references a source outside the current search.");
  for (const claim of proposal.claims) {
    if (new Set(claim.sourceIds).size !== claim.sourceIds.length) throw new Error("A claim may reference each source only once.");
    for (const id of claim.sourceIds) if (!current.has(id)) throw new Error("Claim references a source outside the current search.");
  }
  return proposal;
}

export const GrantWebSearchResultSchema = z.object({
  resultId: UuidSchema,
  title: z.string().trim().min(1).max(500),
  url: z.string().url().max(3000),
  snippet: z.string().trim().max(1200),
  provider: z.string().trim().min(1).max(100),
}).strict();

export const GrantWebSearchSessionSchema = z.object({
  searchSessionId: UuidSchema,
  documentId: UuidSchema,
  query: z.string().trim().min(2).max(500),
  status: z.enum(["awaiting_selection", "partially_confirmed", "completed", "expired"]),
  results: z.array(GrantWebSearchResultSchema).max(10),
  createdBy: UuidSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
}).strict();

export const GrantWebSourceSnapshotSchema = z.object({
  snapshotId: UuidSchema,
  documentId: UuidSchema,
  searchSessionId: UuidSchema,
  resultId: UuidSchema,
  requestedUrl: z.string().url().max(3000),
  finalUrl: z.string().url().max(3000),
  title: z.string().trim().min(1).max(500),
  contentHash: Sha256Schema,
  capturedByteSize: z.number().int().positive().max(2 * 1024 * 1024),
  evidenceSourceId: UuidSchema,
  capturedBy: UuidSchema,
  capturedAt: TimestampSchema,
}).strict();

export type GrantWebSearchResult = z.infer<typeof GrantWebSearchResultSchema>;
export type GrantWebSearchSession = z.infer<typeof GrantWebSearchSessionSchema>;
export type GrantWebSourceSnapshot = z.infer<typeof GrantWebSourceSnapshotSchema>;
export type GrantWebSourceRecord = z.infer<typeof GrantWebSourceRecordSchema>;
export type GrantWebPublicSourceSnapshot = z.infer<typeof GrantWebPublicSourceSnapshotSchema>;
export type GrantWebSourceUsageEvent = z.infer<typeof GrantWebSourceUsageEventSchema>;
export type GrantWebSourceAssessment = z.infer<typeof GrantWebSourceAssessmentSchema>;
export type GrantWebQueryRewriteProposal = z.infer<typeof GrantWebQueryRewriteProposalSchema>;
export type GrantWebGroundedClaim = z.infer<typeof GrantWebGroundedClaimSchema>;
export type GrantWebSynthesisProposal = z.infer<typeof GrantWebSynthesisProposalSchema>;
export type GrantWebSourceAssessmentProposal = z.infer<typeof GrantWebSourceAssessmentProposalSchema>;
export type GrantWebAnswerProposal = z.infer<typeof GrantWebAnswerProposalSchema>;
