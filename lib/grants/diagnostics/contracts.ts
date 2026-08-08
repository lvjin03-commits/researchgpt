import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmptyTextSchema = z.string().trim().min(1);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const GrantDiagnosticInputModeSchema = z.enum([
  "full_document",
  "section_bundle",
  "focused_excerpt",
]);

export const GrantFindingAssessmentSchema = z.object({
  scope: z.enum(["cross_section", "section", "paragraph", "sentence", "term_or_citation"]),
  confidence: z.number().min(0).max(1),
  actionability: z.enum(["directly_actionable", "requires_evidence", "requires_expert_judgment"]),
}).strict();

export const GrantSourceAnchorSchema = z.object({
  sourceRevisionId: UuidSchema,
  locationStatus: z.enum(["located", "unlocated"]),
  sectionId: UuidSchema.optional(),
  nodeId: UuidSchema.optional(),
  nodeType: z.enum(["heading", "paragraph", "list", "table", "figure", "citation", "formula"]).optional(),
  sectionRole: z.string(),
  heading: z.string(),
  text: z.string(),
  textHash: Sha256Schema,
  previousText: z.string(),
  nextText: z.string(),
  startOffset: z.number().int().nonnegative().optional(),
  endOffset: z.number().int().nonnegative().optional(),
  unlocatedReason: NonEmptyTextSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.locationStatus === "located" && (!value.sectionId || !value.nodeId || !value.nodeType)) {
    context.addIssue({ code: "custom", message: "Located anchors require section, node and node type." });
  }
  if (value.locationStatus === "unlocated" && !value.unlocatedReason) {
    context.addIssue({ code: "custom", message: "Unlocated anchors require an explicit reason." });
  }
  if (value.startOffset !== undefined && value.endOffset !== undefined && value.endOffset < value.startOffset) {
    context.addIssue({ code: "custom", path: ["endOffset"], message: "Anchor end must not precede start." });
  }
});

export const GrantDiagnosticRunSchema = z.object({
  runId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: NonEmptyTextSchema,
  checkerVersion: NonEmptyTextSchema,
  contractVersion: NonEmptyTextSchema,
  inputMode: GrantDiagnosticInputModeSchema,
  inputNodeIds: z.array(UuidSchema),
  inputHash: Sha256Schema,
  status: z.enum(["succeeded", "failed"]),
  parsedOutput: z.record(z.string(), z.unknown()),
  failureCode: NonEmptyTextSchema.optional(),
  createdBy: UuidSchema,
  startedAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema,
}).strict();

export const GrantFindingSchema = z.object({
  findingId: UuidSchema,
  runId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  checkerId: NonEmptyTextSchema,
  checkerVersion: NonEmptyTextSchema,
  fingerprint: Sha256Schema,
  code: NonEmptyTextSchema,
  message: NonEmptyTextSchema,
  recommendation: NonEmptyTextSchema,
  assessment: GrantFindingAssessmentSchema,
  sourceAnchor: GrantSourceAnchorSchema,
  lifecycleStatus: z.enum(["open", "closed", "superseded"]),
  createdAt: IsoTimestampSchema,
}).strict();

export const GrantDiagnosticConflictSchema = z.object({
  conflictId: UuidSchema,
  documentId: UuidSchema,
  sourceRevisionId: UuidSchema,
  subjectFingerprint: Sha256Schema,
  findingIds: z.array(UuidSchema).min(2),
  conflictKind: z.literal("checker_disagreement"),
  details: z.record(z.string(), z.unknown()),
  createdAt: IsoTimestampSchema,
}).strict();

export const GrantAnchorResolutionSchema = z.object({
  status: z.enum(["exact", "relocated", "ambiguous", "unable_to_match", "human_review_required"]),
  targetRevisionId: UuidSchema,
  targetNodeId: UuidSchema.optional(),
  score: z.number().min(0).max(1),
  margin: z.number().min(0).max(1),
  candidates: z.array(z.object({ nodeId: UuidSchema, score: z.number().min(0).max(1) }).strict()).max(3),
  reason: NonEmptyTextSchema,
}).strict();

export type GrantDiagnosticInputMode = z.infer<typeof GrantDiagnosticInputModeSchema>;
export type GrantFindingAssessment = z.infer<typeof GrantFindingAssessmentSchema>;
export type GrantSourceAnchor = z.infer<typeof GrantSourceAnchorSchema>;
export type GrantDiagnosticRun = z.infer<typeof GrantDiagnosticRunSchema>;
export type GrantFinding = z.infer<typeof GrantFindingSchema>;
export type GrantDiagnosticConflict = z.infer<typeof GrantDiagnosticConflictSchema>;
export type GrantAnchorResolution = z.infer<typeof GrantAnchorResolutionSchema>;
