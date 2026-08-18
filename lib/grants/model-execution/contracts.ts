import { z } from "zod";
import {
  GRANT_ASSISTANT_CHAT_OPERATION,
  GRANT_ASSISTANT_CHAT_POLICY_VERSION,
  GRANT_EDIT_SESSION_TURN_OPERATION,
  GRANT_EDIT_SESSION_TURN_POLICY_VERSION,
} from "./operation-registry.ts";

// Historical values remain parseable for audit. They are intentionally absent
// from the executable Operation Registry and cannot be selected for new calls.
const LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_OPERATION = "grant.edit_candidate.explain" as const;
const LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_POLICY_VERSION = "grant-edit-candidate-explain-v1" as const;

const UuidSchema = z.string().uuid();
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const GrantModelCallAttemptSchema = z.object({
  callId: UuidSchema,
  traceId: UuidSchema,
  documentId: UuidSchema,
  sessionId: UuidSchema.optional(),
  turnId: UuidSchema.optional(),
  operation: z.enum([GRANT_EDIT_SESSION_TURN_OPERATION, GRANT_ASSISTANT_CHAT_OPERATION, LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_OPERATION]),
  policyVersion: z.enum([GRANT_EDIT_SESSION_TURN_POLICY_VERSION, GRANT_ASSISTANT_CHAT_POLICY_VERSION, LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_POLICY_VERSION]),
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
}).strict().superRefine((attempt, context) => {
  const expectedPolicy = attempt.operation === GRANT_ASSISTANT_CHAT_OPERATION
    ? GRANT_ASSISTANT_CHAT_POLICY_VERSION
    : attempt.operation === LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_OPERATION
      ? LEGACY_GRANT_EDIT_CANDIDATE_EXPLAIN_POLICY_VERSION
      : GRANT_EDIT_SESSION_TURN_POLICY_VERSION;
  if (attempt.policyVersion !== expectedPolicy) {
    context.addIssue({
      code: "custom",
      path: ["policyVersion"],
      message: `Policy ${attempt.policyVersion} does not own operation ${attempt.operation}.`,
    });
  }
});

export type GrantModelCallAttempt = z.infer<typeof GrantModelCallAttemptSchema>;
