import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmptyTextSchema = z.string().trim().min(1);
const IsoTimestampSchema = z.string().datetime({ offset: true });

const HeadingContentSchema = z.object({
  text: NonEmptyTextSchema,
  level: z.number().int().min(1).max(6),
}).strict();

const ParagraphContentSchema = z.object({ text: NonEmptyTextSchema }).strict();
const ListContentSchema = z.object({
  ordered: z.boolean(),
  items: z.array(NonEmptyTextSchema).min(1),
}).strict();
const TableContentSchema = z.object({
  rows: z.array(z.array(z.string()).min(1)).min(1),
}).strict().superRefine((value, context) => {
  const width = value.rows[0]?.length ?? 0;
  value.rows.forEach((row, index) => {
    if (row.length !== width) {
      context.addIssue({
        code: "custom",
        path: ["rows", index],
        message: "All table rows must have the same number of cells.",
      });
    }
  });
});
const FigureContentSchema = z.object({
  assetId: UuidSchema,
  altText: NonEmptyTextSchema,
  caption: z.string().trim().optional(),
}).strict();
const CitationContentSchema = z.object({ referenceId: UuidSchema }).strict();
const FormulaContentSchema = z.object({ latex: NonEmptyTextSchema }).strict();

const DraftNodeSchema = z.discriminatedUnion("nodeType", [
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("heading"), content: HeadingContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("paragraph"), content: ParagraphContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("list"), content: ListContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("table"), content: TableContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("figure"), content: FigureContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("citation"), content: CitationContentSchema }).strict(),
  z.object({ localKey: NonEmptyTextSchema, nodeType: z.literal("formula"), content: FormulaContentSchema }).strict(),
]);

export const GrantDocumentDraftSchema = z.object({
  title: NonEmptyTextSchema,
  sections: z.array(z.object({
    localKey: NonEmptyTextSchema,
    semanticRole: NonEmptyTextSchema,
    title: NonEmptyTextSchema,
    parentLocalKey: NonEmptyTextSchema.optional(),
    order: z.number().int().min(0),
    nodes: z.array(DraftNodeSchema),
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  const sectionKeys = new Set<string>();
  const nodeKeys = new Set<string>();
  const siblingOrders = new Set<string>();
  value.sections.forEach((section, sectionIndex) => {
    if (sectionKeys.has(section.localKey)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "localKey"], message: "Section local keys must be unique." });
    }
    sectionKeys.add(section.localKey);
    section.nodes.forEach((node, nodeIndex) => {
      if (nodeKeys.has(node.localKey)) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "nodes", nodeIndex, "localKey"], message: "Node local keys must be unique." });
      }
      nodeKeys.add(node.localKey);
    });
  });
  value.sections.forEach((section, sectionIndex) => {
    if (section.parentLocalKey && !sectionKeys.has(section.parentLocalKey)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "parentLocalKey"], message: "Parent section must exist." });
    }
    if (section.parentLocalKey === section.localKey) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "parentLocalKey"], message: "A section cannot parent itself." });
    }
    const orderKey = `${section.parentLocalKey ?? "root"}:${section.order}`;
    if (siblingOrders.has(orderKey)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "order"], message: "Sibling section order must be unique." });
    }
    siblingOrders.add(orderKey);
  });
  const parentBySection = new Map(value.sections.map((section) => [section.localKey, section.parentLocalKey]));
  value.sections.forEach((section, sectionIndex) => {
    const visited = new Set<string>();
    let current: string | undefined = section.localKey;
    while (current) {
      if (visited.has(current)) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "parentLocalKey"], message: "Section parent relationships cannot contain a cycle." });
        break;
      }
      visited.add(current);
      current = parentBySection.get(current);
    }
  });
});

const CanonicalNodeSchema = z.discriminatedUnion("nodeType", [
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("heading"), content: HeadingContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("paragraph"), content: ParagraphContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("list"), content: ListContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("table"), content: TableContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("figure"), content: FigureContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("citation"), content: CitationContentSchema }).strict(),
  z.object({ nodeId: UuidSchema, sectionId: UuidSchema, order: z.number().int().min(0), nodeType: z.literal("formula"), content: FormulaContentSchema }).strict(),
]);

export const CanonicalGrantSnapshotSchema = z.object({
  schemaVersion: z.literal("grant-canonical-v1"),
  title: NonEmptyTextSchema,
  sections: z.array(z.object({
    sectionId: UuidSchema,
    semanticRole: NonEmptyTextSchema,
    title: NonEmptyTextSchema,
    parentSectionId: UuidSchema.optional(),
    order: z.number().int().min(0),
    nodeIds: z.array(UuidSchema),
  }).strict()).min(1),
  nodes: z.array(CanonicalNodeSchema),
}).strict().superRefine((value, context) => {
  const sectionIds = new Set<string>();
  const nodeIds = new Set<string>();
  const assignedNodeIds = new Set<string>();
  const siblingOrders = new Set<string>();
  value.sections.forEach((section, index) => {
    if (sectionIds.has(section.sectionId)) {
      context.addIssue({ code: "custom", path: ["sections", index, "sectionId"], message: "Section IDs must be unique." });
    }
    sectionIds.add(section.sectionId);
    const orderKey = `${section.parentSectionId ?? "root"}:${section.order}`;
    if (siblingOrders.has(orderKey)) {
      context.addIssue({ code: "custom", path: ["sections", index, "order"], message: "Sibling section order must be unique." });
    }
    siblingOrders.add(orderKey);
  });
  value.nodes.forEach((node, index) => {
    if (nodeIds.has(node.nodeId)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "nodeId"], message: "Node IDs must be unique." });
    }
    nodeIds.add(node.nodeId);
    if (!sectionIds.has(node.sectionId)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "sectionId"], message: "Node section must exist." });
    }
  });
  value.sections.forEach((section, sectionIndex) => {
    if (section.parentSectionId && !sectionIds.has(section.parentSectionId)) {
      context.addIssue({ code: "custom", path: ["sections", sectionIndex, "parentSectionId"], message: "Parent section must exist." });
    }
    section.nodeIds.forEach((nodeId, nodeIndex) => {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "nodeIds", nodeIndex], message: "Assigned node must exist." });
      }
      if (assignedNodeIds.has(nodeId)) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "nodeIds", nodeIndex], message: "A node may be assigned to only one section." });
      }
      assignedNodeIds.add(nodeId);
      const node = value.nodes.find((candidate) => candidate.nodeId === nodeId);
      if (node && node.sectionId !== section.sectionId) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "nodeIds", nodeIndex], message: "Node sectionId must match its assignment." });
      }
    });
  });
  const parentBySection = new Map(value.sections.map((section) => [section.sectionId, section.parentSectionId]));
  value.sections.forEach((section, sectionIndex) => {
    const visited = new Set<string>();
    let current: string | undefined = section.sectionId;
    while (current) {
      if (visited.has(current)) {
        context.addIssue({ code: "custom", path: ["sections", sectionIndex, "parentSectionId"], message: "Section parent relationships cannot contain a cycle." });
        break;
      }
      visited.add(current);
      current = parentBySection.get(current);
    }
  });
  const nodeOrdersBySection = new Set<string>();
  value.nodes.forEach((node, index) => {
    const orderKey = `${node.sectionId}:${node.order}`;
    if (nodeOrdersBySection.has(orderKey)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "order"], message: "Node order must be unique within a section." });
    }
    nodeOrdersBySection.add(orderKey);
  });
  value.nodes.forEach((node, index) => {
    if (!assignedNodeIds.has(node.nodeId)) {
      context.addIssue({ code: "custom", path: ["nodes", index, "nodeId"], message: "Every node must be assigned to a section." });
    }
  });
});

export const TemplateSnapshotSchema = z.object({
  templateSnapshotId: UuidSchema,
  ownerId: UuidSchema,
  templateKey: NonEmptyTextSchema,
  templateVersion: NonEmptyTextSchema,
  rules: z.record(z.string(), z.unknown()),
  checksum: Sha256Schema,
  createdAt: IsoTimestampSchema,
}).strict();

export const GrantDocumentSchema = z.object({
  documentId: UuidSchema,
  ownerId: UuidSchema,
  title: NonEmptyTextSchema,
  templateSnapshotId: UuidSchema,
  currentRevisionId: UuidSchema,
  currentRevisionNumber: z.number().int().positive(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).strict();

export const GrantRevisionSchema = z.object({
  revisionId: UuidSchema,
  documentId: UuidSchema,
  revisionNumber: z.number().int().positive(),
  parentRevisionId: UuidSchema.nullish().transform((value) => value ?? undefined),
  templateSnapshotId: UuidSchema,
  contentHash: Sha256Schema,
  snapshot: CanonicalGrantSnapshotSchema,
  createdBy: UuidSchema,
  createdAt: IsoTimestampSchema,
}).strict();

export const GrantRevisionSummarySchema = GrantRevisionSchema.omit({ snapshot: true });

export const GrantLengthEstimateSchema = z.object({
  visibleCharacters: z.number().int().nonnegative(),
  hanCharacters: z.number().int().nonnegative(),
  latinWords: z.number().int().nonnegative(),
  estimatedPages: z.number().int().nonnegative(),
  charactersPerPage: z.number().int().positive(),
  maximumEstimatedPages: z.number().int().positive().optional(),
  exceedsEstimatedLimit: z.boolean(),
}).strict();

export const GrantAuditEventSchema = z.object({
  auditEventId: UuidSchema,
  documentId: UuidSchema,
  revisionId: UuidSchema,
  actorId: UuidSchema,
  actorKind: z.enum(["user", "system", "ai"]),
  eventType: z.enum(["document_created", "revision_committed"]),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: IsoTimestampSchema,
}).strict();

export type GrantDocumentDraft = z.infer<typeof GrantDocumentDraftSchema>;
export type CanonicalGrantSnapshot = z.infer<typeof CanonicalGrantSnapshotSchema>;
export type TemplateSnapshot = z.infer<typeof TemplateSnapshotSchema>;
export type GrantDocument = z.infer<typeof GrantDocumentSchema>;
export type GrantRevision = z.infer<typeof GrantRevisionSchema>;
export type GrantRevisionSummary = z.infer<typeof GrantRevisionSummarySchema>;
export type GrantLengthEstimate = z.infer<typeof GrantLengthEstimateSchema>;
export type GrantAuditEvent = z.infer<typeof GrantAuditEventSchema>;
