import { z } from "zod";

const UuidSchema = z.string().uuid();

export const GrantCandidateExplanationModelResultSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  changes: z.array(z.object({
    changeIndex: z.number().int().min(0),
    explanation: z.string().trim().min(1).max(1200),
  }).strict()).max(1000),
  cautions: z.array(z.string().trim().min(1).max(1000)).max(24),
}).strict();

export const GrantCandidateExplanationSchema = GrantCandidateExplanationModelResultSchema.extend({
  candidateId: UuidSchema,
  diffHash: z.string().regex(/^[a-f0-9]{64}$/),
  blockingIssues: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000),
  }).strict()).max(48),
  sources: z.array(z.object({
    sourceId: UuidSchema,
    sourceTitle: z.string().trim().min(1).max(500),
    usedWhenGenerated: z.literal(true),
    currentlyAuthorized: z.boolean(),
    status: z.enum(["current", "revoked", "expired", "changed"]),
  }).strict()).max(48),
  provider: z.literal("openai"),
  modelId: z.string().trim().min(1),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export type GrantCandidateExplanation = z.infer<typeof GrantCandidateExplanationSchema>;
export type GrantCandidateExplanationModelResult = z.infer<typeof GrantCandidateExplanationModelResultSchema>;
