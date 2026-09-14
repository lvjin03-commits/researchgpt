import { z } from "zod";

export const GrantAssistantContextCoverageSchema = z.object({
  mode: z.enum(["full_document", "retrieved_excerpts"]),
  strategy: z.enum(["single_pass", "hierarchical", "long_context", "retrieval"]),
  sourceRevisionId: z.string().uuid(),
  sectionCount: z.number().int().nonnegative(),
  coveredSectionCount: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  coveredNodeCount: z.number().int().nonnegative(),
  complete: z.boolean(),
  unitCount: z.number().int().positive().optional(),
}).strict();

export type GrantAssistantContextCoverage = z.infer<typeof GrantAssistantContextCoverageSchema>;
