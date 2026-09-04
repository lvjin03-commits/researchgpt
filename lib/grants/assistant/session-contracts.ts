import { z } from "zod";
import { GrantAssistantAnswerSchema } from "./answer-contract.ts";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });

export const GrantAssistantSessionSchema = z.object({
  sessionId: UuidSchema,
  documentId: UuidSchema,
  status: z.enum(["active", "stale", "expired"]),
  createdAt: TimestampSchema,
  lastActiveAt: TimestampSchema,
}).strict();

// Runtime/provider metadata belongs to the model-call record, not the
// reusable answer contract. Strip it when reading legacy cached turns so a
// previous provider result cannot invalidate the next chat request.
const CachedAnswerSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { provider: _provider, modelId: _modelId, ...answer } = value as Record<string, unknown>;
  return answer;
}, GrantAssistantAnswerSchema);

export const GrantAssistantMessageSchema = z.object({
  messageId: UuidSchema,
  sessionId: UuidSchema,
  turnId: UuidSchema,
  traceId: UuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
  grounding: z.enum(["general_reasoning", "evidence_grounded"]).optional(),
  citations: z.array(z.object({ citationId: z.string(), sourceType: z.enum(["document_selection", "edit_candidate", "evidence", "academic_source"]), label: z.string() }).strict()).max(24).default([]),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  cachedAnswer: CachedAnswerSchema.optional(),
  recommendedQuestions: z.array(z.string().min(1).max(160)).max(6).optional(),
  createdAt: TimestampSchema,
}).strict();

export type GrantAssistantSession = z.infer<typeof GrantAssistantSessionSchema>;
export type GrantAssistantMessage = z.infer<typeof GrantAssistantMessageSchema>;

export const GRANT_ASSISTANT_STALE_AFTER_DAYS = 7;
export const GRANT_ASSISTANT_GENERAL_CONTENT_RETENTION_DAYS = 90;
