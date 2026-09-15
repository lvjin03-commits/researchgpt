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

const MemoryItemIdSchema = z.string().regex(/^M\d+$/u);
const MemoryItemIdsByKindSchema = z.object({
  scientific_problem: z.array(MemoryItemIdSchema),
  research_objective: z.array(MemoryItemIdSchema),
  research_content: z.array(MemoryItemIdSchema),
  technical_route: z.array(MemoryItemIdSchema),
  innovation: z.array(MemoryItemIdSchema),
  preliminary_basis: z.array(MemoryItemIdSchema),
  feasibility: z.array(MemoryItemIdSchema),
  risk: z.array(MemoryItemIdSchema),
  constraint: z.array(MemoryItemIdSchema),
  other: z.array(MemoryItemIdSchema),
});

export const GrantDocumentMemoryCognitionSchema = z.object({
  overview: z.string().min(1),
  itemIdsByKind: MemoryItemIdsByKindSchema,
});

export const GrantDocumentMemorySectionSchema = z.object({
  sectionId: z.string().uuid(),
  parentSectionId: z.string().uuid().nullable(),
  title: z.string().min(1),
  semanticRole: z.string().min(1),
  summary: z.string().min(1),
});

export const GrantDocumentMemoryItemSchema = z.object({
  memoryItemId: MemoryItemIdSchema,
  kind: GrantDocumentMemoryItemKindSchema,
  statement: z.string().min(1),
  concepts: z.array(z.string().min(1)).max(12),
  sourceSectionIds: z.array(z.string().uuid()).min(1),
});

export const GrantDocumentMemorySectionAnchorSchema = z.object({
  sectionId: z.string().uuid(),
  sourceNodeIds: z.array(z.string().uuid()),
});

export const GrantDocumentMemoryItemAnchorSchema = z.object({
  memoryItemId: MemoryItemIdSchema,
  sourceNodeIds: z.array(z.string().uuid()).min(1),
});

const GrantDocumentMemorySnapshotBaseSchema = z.object({
  schemaVersion: z.literal("grant-document-memory-v2"),
  memoryId: z.string().uuid(),
  documentId: z.string().uuid(),
  sourceRevisionId: z.string().uuid(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/u),
  memoryHash: z.string().regex(/^[a-f0-9]{64}$/u),
  policyVersion: z.string().min(1),
  provider: z.literal("openai"),
  modelId: z.string().min(1),
  builtAt: z.string().datetime({ offset: true }),
  l0: GrantDocumentMemoryCognitionSchema,
  l1: z.object({ sections: z.array(GrantDocumentMemorySectionSchema),
    items: z.array(GrantDocumentMemoryItemSchema) }),
  l2: z.object({ sectionAnchors: z.array(GrantDocumentMemorySectionAnchorSchema),
    itemAnchors: z.array(GrantDocumentMemoryItemAnchorSchema) }),
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

export const GrantDocumentMemorySnapshotSchema = GrantDocumentMemorySnapshotBaseSchema.superRefine((memory, context) => {
  const sectionIds = memory.l1.sections.map((section) => section.sectionId);
  const itemIds = memory.l1.items.map((item) => item.memoryItemId);
  const sectionAnchorIds = memory.l2.sectionAnchors.map((anchor) => anchor.sectionId);
  const itemAnchorIds = memory.l2.itemAnchors.map((anchor) => anchor.memoryItemId);
  const requireSameUniqueIds = (expected: string[], actual: string[], path: (string | number)[], label: string) => {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    if (expectedSet.size !== expected.length || actualSet.size !== actual.length
      || expectedSet.size !== actualSet.size || [...expectedSet].some((id) => !actualSet.has(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path,
        message: `${label} must cover every L1 entity exactly once.` });
    }
  };
  requireSameUniqueIds(sectionIds, sectionAnchorIds, ["l2", "sectionAnchors"], "L2 section anchors");
  requireSameUniqueIds(itemIds, itemAnchorIds, ["l2", "itemAnchors"], "L2 item anchors");
  const knownSections = new Set(sectionIds);
  const knownItems = new Set(itemIds);
  memory.l1.items.forEach((item, index) => {
    if (item.sourceSectionIds.some((sectionId) => !knownSections.has(sectionId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["l1", "items", index, "sourceSectionIds"],
        message: "L1 memory item references an unavailable section." });
    }
  });
  memory.l1.sections.forEach((section, index) => {
    if (section.parentSectionId && !knownSections.has(section.parentSectionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["l1", "sections", index, "parentSectionId"],
        message: "L1 section references an unavailable parent section." });
    }
  });
  Object.entries(memory.l0.itemIdsByKind).forEach(([kind, ids]) => {
    ids.forEach((id, index) => {
      const item = memory.l1.items.find((candidate) => candidate.memoryItemId === id);
      if (!knownItems.has(id) || item?.kind !== kind) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["l0", "itemIdsByKind", kind, index],
          message: "L0 cognition index references an unavailable or mismatched L1 memory item." });
      }
    });
  });
});

export type GrantDocumentMemoryItemKind = z.infer<typeof GrantDocumentMemoryItemKindSchema>;
export type GrantDocumentMemorySnapshot = z.infer<typeof GrantDocumentMemorySnapshotSchema>;
