import { z } from "zod";
import { REGISTERED_AI_OPERATIONS } from "./operation-registry.ts";

const CountSchema = z.number().int().nonnegative().safe();

export const TokenBillableUsageSchema = z.object({
  kind: z.literal("tokens"),
  inputTokens: CountSchema,
  cachedInputTokens: CountSchema,
  outputTokens: CountSchema,
  reasoningTokens: CountSchema,
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({ code: "custom", path: ["cachedInputTokens"], message: "Cached input cannot exceed total input." });
  }
  if (usage.reasoningTokens > usage.outputTokens) {
    context.addIssue({ code: "custom", path: ["reasoningTokens"], message: "Reasoning tokens are an informational subset of total output tokens." });
  }
});

export const ToolCallBillableUsageSchema = z.object({
  kind: z.literal("tool_call"),
  tool: z.string().trim().min(1).max(100),
  count: CountSchema,
}).strict();

export const ImageInputBillableUsageSchema = z.object({
  kind: z.literal("image_input"),
  units: CountSchema,
  detail: z.string().trim().min(1).max(100),
}).strict();

export const ImageGenerationBillableUsageSchema = z.object({
  kind: z.literal("image_generation"),
  count: CountSchema,
  size: z.string().trim().min(1).max(50),
  quality: z.string().trim().min(1).max(50),
}).strict();

export const AudioBillableUsageSchema = z.object({
  kind: z.literal("audio"),
  durationMilliseconds: CountSchema,
}).strict();

export const VideoBillableUsageSchema = z.object({
  kind: z.literal("video"),
  durationMilliseconds: CountSchema,
  resolution: z.string().trim().min(1).max(50),
}).strict();

export const StandardizedBillableUsageSchema = z.discriminatedUnion("kind", [
  TokenBillableUsageSchema,
  ToolCallBillableUsageSchema,
  ImageInputBillableUsageSchema,
  ImageGenerationBillableUsageSchema,
  AudioBillableUsageSchema,
  VideoBillableUsageSchema,
]);
export type StandardizedBillableUsage = z.infer<typeof StandardizedBillableUsageSchema>;

export const AiUsageEnvelopeSchema = z.object({
  usageEventId: z.string().uuid(),
  billingOperationId: z.string().uuid(),
  operation: z.enum(REGISTERED_AI_OPERATIONS),
  provider: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200),
  attemptNumber: z.number().int().positive(),
  cacheHit: z.boolean(),
  usage: z.array(StandardizedBillableUsageSchema).min(1),
  occurredAt: z.string().datetime({ offset: true }),
}).strict();
export type AiUsageEnvelope = z.infer<typeof AiUsageEnvelopeSchema>;

export function tokenUsage(input: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}): StandardizedBillableUsage {
  return TokenBillableUsageSchema.parse({
    kind: "tokens",
    inputTokens: input.inputTokens ?? 0,
    cachedInputTokens: input.cachedInputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    reasoningTokens: input.reasoningTokens ?? 0,
  });
}
