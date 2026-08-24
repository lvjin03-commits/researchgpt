import { z } from "zod";
import { REGISTERED_AI_OPERATIONS } from "../../ai/operation-registry.ts";

export const ResumeIntentStatusSchema = z.enum([
  "awaiting_payment",
  "needs_revalidation",
  "ready",
  "stale",
  "consumed",
  "cancelled",
  "expired",
]);
export type ResumeIntentStatus = z.infer<typeof ResumeIntentStatusSchema>;

export const ResumeIntentContextSchema = z.object({
  sourcePath: z.string().startsWith("/").max(500),
  documentId: z.string().uuid().nullable(),
  editSessionId: z.string().uuid().nullable(),
  candidateId: z.string().uuid().nullable(),
  instructionDraft: z.string().max(10_000).nullable(),
  baselineHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
export type ResumeIntentContext = z.infer<typeof ResumeIntentContextSchema>;

export const ResumeIntentSchema = z.object({
  resumeIntentId: z.string().uuid(),
  ownerId: z.string().uuid(),
  operation: z.enum(REGISTERED_AI_OPERATIONS),
  requiredPoints: z.number().int().positive().safe(),
  context: ResumeIntentContextSchema,
  status: ResumeIntentStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  revalidatedAt: z.string().datetime({ offset: true }).nullable(),
  consumedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type ResumeIntent = z.infer<typeof ResumeIntentSchema>;
