import { z } from "zod";

export const GrantAssistantAnswerModeSchema = z.enum([
  "answer",
  "explain",
  "analyze",
  "compare",
  "review",
  "revise_guidance",
]);

export const GrantAssistantWebRecommendationSchema = z.enum(["none", "recommended"]);

const CanonicalTargetIdsSchema = z.object({
  targetSectionIds: z.array(z.string().uuid()),
  targetMemoryItemIds: z.array(z.string().regex(/^M\d+$/u)),
}).strict();

export const GrantAssistantMemoryScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_memory") }).strict(),
  z.object({ kind: z.literal("targets"), ...CanonicalTargetIdsSchema.shape }).strict(),
]);

export const GrantAssistantDocumentScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory_only") }).strict(),
  z.object({ kind: z.literal("targeted_original"), ...CanonicalTargetIdsSchema.shape }).strict(),
  z.object({ kind: z.literal("full_original") }).strict(),
]);

export const GrantAssistantDiagnosticScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("relevant"), ...CanonicalTargetIdsSchema.shape }).strict(),
  z.object({ kind: z.literal("all") }).strict(),
]);

const AliasTargetsSchema = z.object({
  sectionAliases: z.array(z.string().trim().min(1).max(80)).max(24),
  memoryItemAliases: z.array(z.string().trim().min(1).max(80)).max(32),
}).strict();

export const GrantAssistantMemoryScopeProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_memory") }).strict(),
  z.object({ kind: z.literal("targets"), ...AliasTargetsSchema.shape }).strict(),
]);

export const GrantAssistantDocumentScopeProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory_only") }).strict(),
  z.object({ kind: z.literal("targeted_original"), ...AliasTargetsSchema.shape }).strict(),
  z.object({ kind: z.literal("full_original") }).strict(),
]);

export const GrantAssistantDiagnosticScopeProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("relevant"), ...AliasTargetsSchema.shape }).strict(),
  z.object({ kind: z.literal("all") }).strict(),
]);

export const GrantAssistantContextPlanSchema = z.object({
  schemaVersion: z.literal("grant-assistant-context-plan-v2"),
  planId: z.string().uuid(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  documentId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  memoryId: z.string().uuid(),
  memoryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  plannerPolicyVersion: z.string().min(1),
  answerMode: GrantAssistantAnswerModeSchema,
  memoryScope: GrantAssistantMemoryScopeSchema,
  documentScope: GrantAssistantDocumentScopeSchema,
  diagnosticScope: GrantAssistantDiagnosticScopeSchema,
  webRecommendation: GrantAssistantWebRecommendationSchema,
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  provider: z.literal("openai"),
  modelId: z.string().min(1),
  providerRequestId: z.string().min(1).optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  }),
});

export type GrantAssistantAnswerMode = z.infer<typeof GrantAssistantAnswerModeSchema>;
export type GrantAssistantWebRecommendation = z.infer<typeof GrantAssistantWebRecommendationSchema>;
export type GrantAssistantMemoryScope = z.infer<typeof GrantAssistantMemoryScopeSchema>;
export type GrantAssistantDocumentScope = z.infer<typeof GrantAssistantDocumentScopeSchema>;
export type GrantAssistantDiagnosticScope = z.infer<typeof GrantAssistantDiagnosticScopeSchema>;
export type GrantAssistantMemoryScopeProposal = z.infer<typeof GrantAssistantMemoryScopeProposalSchema>;
export type GrantAssistantDocumentScopeProposal = z.infer<typeof GrantAssistantDocumentScopeProposalSchema>;
export type GrantAssistantDiagnosticScopeProposal = z.infer<typeof GrantAssistantDiagnosticScopeProposalSchema>;
export type GrantAssistantContextPlan = z.infer<typeof GrantAssistantContextPlanSchema>;
