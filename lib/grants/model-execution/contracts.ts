import { z } from "zod";
import { GRANT_EDIT_SESSION_TURN_OPERATION, GRANT_EDIT_SESSION_TURN_POLICY_VERSION } from "./operation-registry.ts";

const UuidSchema = z.string().uuid();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const GrantModelCallAttemptSchema = z.object({
  callId: UuidSchema,
  traceId: UuidSchema,
  documentId: UuidSchema,
  sessionId: UuidSchema.optional(),
  turnId: UuidSchema.optional(),
  operation: z.literal(GRANT_EDIT_SESSION_TURN_OPERATION),
  policyVersion: z.literal(GRANT_EDIT_SESSION_TURN_POLICY_VERSION),
  provider: z.literal("openai"),
  modelId: z.string().trim().min(1),
  attemptNumber: z.number().int().min(1).max(2),
  attemptPurpose: z.enum(["initial", "schema_repair", "capacity_retry", "transient_retry"]),
  status: z.enum(["started", "succeeded", "failed"]),
  inputHash: HashSchema,
  outputHash: HashSchema.optional(),
  providerRequestId: z.string().trim().min(1).optional(),
  failureCategory: z.string().trim().min(1).optional(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  reasoningTokens: z.number().int().nonnegative().default(0),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

export type GrantModelCallAttempt = z.infer<typeof GrantModelCallAttemptSchema>;

