import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

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

