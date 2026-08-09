import { z } from "zod";

const UuidSchema = z.string().uuid();

export const GrantFindingDispositionSchema = z.enum([
  "none",
  "prioritized",
  "deferred",
  "ignored",
  "reported_false_positive",
]);

export const GrantFindingFeedbackSchema = z.object({
  findingId: UuidSchema,
  documentId: UuidSchema,
  disposition: GrantFindingDispositionSchema,
  updatedBy: UuidSchema,
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export type GrantFindingDisposition = z.infer<typeof GrantFindingDispositionSchema>;
export type GrantFindingFeedback = z.infer<typeof GrantFindingFeedbackSchema>;
