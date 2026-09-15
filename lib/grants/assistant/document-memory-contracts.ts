import { z } from "zod";

export const GrantDocumentMemoryItemKindSchema = z.enum([
  "scientific_problem",
  "research_objective",
  "research_content",
  "technical_route",
  "innovation",
  "preliminary_basis",
  "feasibility",
  "risk",
  "constraint",
  "other",
]);

export const GrantDocumentMemorySectionSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1),
  semanticRole: z.string().min(1),
  summary: z.string().min(1),
  sourceNodeIds: z.array(z.string().uuid()),
});

export const GrantDocumentMemoryItemSchema = z.object({
  memoryItemId: z.string().regex(/^M\d+$/u),
  kind: GrantDocumentMemoryItemKindSchema,
  statement: z.string().min(1),
  concepts: z.array(z.string().min(1)).max(12),
  sourceSectionIds: z.array(z.string().uuid()).min(1),
  sourceNodeIds: z.array(z.string().uuid()).min(1),
});

export const GrantDocumentMemorySnapshotSchema = z.object({
  schemaVersion: z.literal("grant-document-memory-v1"),
  memoryId: z.string().uuid(),
  documentId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  memoryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  policyVersion: z.string().min(1),
  provider: z.literal("openai"),
  modelId: z.string().min(1),
  builtAt: z.string().datetime({ offset: true }),
  overview: z.string().min(1),
  sections: z.array(GrantDocumentMemorySectionSchema),
  items: z.array(GrantDocumentMemoryItemSchema),
  coverage: z.object({
    sectionCount: z.number().int().nonnegative(),
    nodeCount: z.number().int().nonnegative(),
    coveredSectionCount: z.number().int().nonnegative(),
    coveredNodeCount: z.number().int().nonnegative(),
    complete: z.literal(true),
  }),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  }),
  providerRequestIds: z.array(z.string().min(1)),
});

export type GrantDocumentMemoryItemKind = z.infer<typeof GrantDocumentMemoryItemKindSchema>;
export type GrantDocumentMemorySnapshot = z.infer<typeof GrantDocumentMemorySnapshotSchema>;
