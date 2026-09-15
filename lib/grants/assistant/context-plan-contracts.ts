import { z } from "zod";

export const GrantAssistantAnswerModeSchema = z.enum([
  "answer",
  "explain",
  "analyze",
  "compare",
  "review",
  "revise_guidance",
]);

export const GrantAssistantDocumentAccessSchema = z.enum([
  "memory_only",
  "targeted_original",
  "full_original",
]);

export const GrantAssistantDiagnosticAccessSchema = z.enum(["none", "relevant", "all"]);
export const GrantAssistantWebRecommendationSchema = z.enum(["none", "recommended"]);

export const GrantAssistantContextPlanSchema = z.object({
  schemaVersion: z.literal("grant-assistant-context-plan-v1"),
  planId: z.string().uuid(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  documentId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  memoryId: z.string().uuid(),
  memoryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  plannerPolicyVersion: z.string().min(1),
  answerMode: GrantAssistantAnswerModeSchema,
  documentAccess: GrantAssistantDocumentAccessSchema,
  diagnosticAccess: GrantAssistantDiagnosticAccessSchema,
  webRecommendation: GrantAssistantWebRecommendationSchema,
  targetSectionIds: z.array(z.string().uuid()),
  targetMemoryItemIds: z.array(z.string().regex(/^M\d+$/u)),
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
export type GrantAssistantDocumentAccess = z.infer<typeof GrantAssistantDocumentAccessSchema>;
export type GrantAssistantDiagnosticAccess = z.infer<typeof GrantAssistantDiagnosticAccessSchema>;
export type GrantAssistantWebRecommendation = z.infer<typeof GrantAssistantWebRecommendationSchema>;
export type GrantAssistantContextPlan = z.infer<typeof GrantAssistantContextPlanSchema>;
