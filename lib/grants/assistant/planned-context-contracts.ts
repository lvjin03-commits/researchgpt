import { z } from "zod";

const UuidSchema = z.string().uuid();

export const GrantAssistantPlannedSourceSchema = z.object({
  sourceAlias: z.string().regex(/^(?:MEMORY|O|G)\d+$/u),
  sourceType: z.enum(["document_memory", "original_text", "diagnostic"]),
  label: z.string().min(1),
  excerpt: z.string().min(1),
  sectionId: UuidSchema.optional(),
  nodeId: UuidSchema.optional(),
  findingId: UuidSchema.optional(),
  memoryId: UuidSchema.optional(),
}).strict();

export const GrantAssistantPlannedContextSchema = z.object({
  schemaVersion: z.literal("grant-assistant-planned-context-v1"),
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  planId: UuidSchema,
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
  memoryId: UuidSchema,
  memoryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  sources: z.array(GrantAssistantPlannedSourceSchema),
  coverage: z.object({
    memoryIncluded: z.literal(true),
    originalMode: z.enum(["memory_only", "targeted_original", "full_original"]),
    totalSectionCount: z.number().int().nonnegative(),
    coveredSectionCount: z.number().int().nonnegative(),
    totalNodeCount: z.number().int().nonnegative(),
    coveredNodeCount: z.number().int().nonnegative(),
    completeOriginal: z.boolean(),
    diagnosticMode: z.enum(["none", "relevant", "all"]),
    availableCurrentFindingCount: z.number().int().nonnegative(),
    admittedFindingCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type GrantAssistantPlannedContext = z.infer<typeof GrantAssistantPlannedContextSchema>;
