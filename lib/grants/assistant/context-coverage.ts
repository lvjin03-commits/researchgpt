import { z } from "zod";

export const GrantAssistantContextCoverageSchema = z.object({
  mode: z.enum(["full_document", "document_memory", "retrieved_excerpts"]),
  strategy: z.enum(["single_pass", "hierarchical", "long_context", "semantic_memory", "semantic_targeted", "retrieval"]),
  sourceRevisionId: z.string().uuid(),
  sectionCount: z.number().int().nonnegative(),
  coveredSectionCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  coveredNodeCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  unitCount: z.number().int().positive().optional(),
  totalUnitCount: z.number().int().positive().optional(),
  synthesisComplete: z.boolean().optional(),
  partialReasonCode: z.string().min(1).max(120).optional(),
}).strict();

export type GrantAssistantContextCoverage = z.infer<typeof GrantAssistantContextCoverageSchema>;
