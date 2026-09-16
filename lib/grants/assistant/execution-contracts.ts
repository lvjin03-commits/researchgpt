import { z } from "zod";
import { GrantAssistantContextPlanSchema } from "./context-plan-contracts.ts";
import { GrantAssistantAnswerSchema } from "./answer-contract.ts";
import { GrantAssistantContextCoverageSchema } from "./context-coverage.ts";

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
}).strict();

const ContextManifestSchema = z.object({
  policyVersion: z.literal("grant-assistant-context-budget-v2"),
  stage: z.enum(["semantic_planning", "grounded_answer", "full_review_unit", "full_review_synthesis"]),
  status: z.enum(["complete", "context_adapted"]),
  modelId: z.string().min(1), tokenizerId: z.string().min(1),
  maximumInputTokens: z.number().int().positive(), reservedOutputTokens: z.number().int().positive(),
  providerFramingReserveTokens: z.number().int().nonnegative(),
  structuredOutputReserveTokens: z.number().int().nonnegative(),
  requiredInputTokens: z.number().int().nonnegative(), estimatedInputTokens: z.number().int().nonnegative(),
  admittedSourceAliases: z.array(z.string()), admittedConversationMessages: z.number().int().nonnegative(),
  omittedConversationMessages: z.number().int().nonnegative(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const GrantAssistantReviewUnitCheckpointSchema = z.object({
  unitId: z.string().min(1),
  unitHash: z.string().regex(/^[a-f0-9]{64}$/u),
  summary: z.string().min(1),
  findings: z.array(z.object({
    statement: z.string().min(1),
    sourceAliases: z.array(z.string().min(1)).min(1),
  }).strict()),
  providerRequestId: z.string().min(1).optional(),
  usage: UsageSchema.optional(),
  provider: z.literal("openai").optional(),
  modelId: z.string().min(1).optional(),
}).strict();

export const GrantAssistantExecutionCheckpointSchema = z.object({
  schemaVersion: z.literal("grant-assistant-execution-checkpoint-v1"),
  plan: GrantAssistantContextPlanSchema.extend({ contextManifest: ContextManifestSchema }).optional(),
  fullReview: z.object({
    contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
    questionHash: z.string().regex(/^[a-f0-9]{64}$/u),
    units: z.array(GrantAssistantReviewUnitCheckpointSchema),
    reductions: z.array(GrantAssistantReviewUnitCheckpointSchema).optional(),
  }).strict().optional(),
  result: GrantAssistantAnswerSchema.optional(),
  contextCoverage: GrantAssistantContextCoverageSchema.optional(),
}).strict();

export type GrantAssistantExecutionCheckpoint = z.infer<typeof GrantAssistantExecutionCheckpointSchema>;

export const GrantAssistantExecutionSchema = z.object({
  executionId: z.string().uuid(),
  documentId: z.string().uuid(),
  turnId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
  policyVersion: z.string().min(1),
  modelId: z.string().min(1),
  status: z.enum(["running", "failed", "completed"]),
  version: z.number().int().nonnegative(),
  leaseToken: z.string().uuid().nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  checkpoint: GrantAssistantExecutionCheckpointSchema,
  failureReasonCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type GrantAssistantExecution = z.infer<typeof GrantAssistantExecutionSchema>;
