import { z } from "zod";

const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const GrantAiEditSafetyStateSchema = z.enum(["passed", "needs_confirmation", "blocked", "needs_repair"]);

export const GrantAiEditClaimKindSchema = z.enum(["numeric_assertion", "factual_assertion", "citation_marker", "reference_entry"]);

export const GrantAiEditClaimSchema = z.object({
  claimRef: z.string().regex(/^C[1-9][0-9]*$/),
  kind: GrantAiEditClaimKindSchema,
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().positive(),
  textHash: Sha256Schema,
}).strict();

export const GrantAiEditClaimBindingSchema = z.object({
  claimRef: z.string().regex(/^C[1-9][0-9]*$/),
  evidenceCardId: UuidSchema.optional(),
  webSourceSnapshotId: UuidSchema.optional(),
}).strict().refine((value) => Number(Boolean(value.evidenceCardId)) + Number(Boolean(value.webSourceSnapshotId)) === 1, {
  message: "A claim binding must identify exactly one authorized source.",
});

export const GrantAiEditFactCheckIssueSchema = z.object({
  code: z.enum(["new_reference_forbidden", "claim_binding_missing", "claim_binding_unknown", "claim_source_unauthorized"]),
  claimRef: z.string().regex(/^C[1-9][0-9]*$/).optional(),
}).strict();

export const GrantAiEditFactCheckReportSchema = z.object({
  policyVersion: z.literal("grant-edit-fact-check-v1"),
  claims: z.array(GrantAiEditClaimSchema),
  bindings: z.array(GrantAiEditClaimBindingSchema),
  issues: z.array(GrantAiEditFactCheckIssueSchema),
  state: GrantAiEditSafetyStateSchema,
}).strict();

export const GrantAiEditSessionSchema = z.object({
  sessionId: UuidSchema,
  documentId: UuidSchema,
  baseRevisionId: UuidSchema,
  targetNodeId: UuidSchema,
  expectedNodeHash: Sha256Schema,
  editMode: z.enum(["replace", "replace_selection", "insert_after"]),
  selectedText: z.string().optional(),
  selectionStart: z.number().int().min(0).optional(),
  selectionEnd: z.number().int().min(0).optional(),
  originFindingId: UuidSchema.optional(),
  status: z.enum(["active", "applied", "discarded", "stale"]),
  activeCandidateId: UuidSchema.optional(),
  lastSafeCandidateId: UuidSchema.optional(),
  appliedCandidateId: UuidSchema.optional(),
  appliedProposalId: UuidSchema.optional(),
  appliedRevisionId: UuidSchema.optional(),
  createdBy: UuidSchema,
  createdAt: TimestampSchema,
  lastActiveAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const hasSelection = value.selectionStart !== undefined || value.selectionEnd !== undefined || value.selectedText !== undefined;
  if (value.editMode === "replace_selection" && (!hasSelection || value.selectionStart === undefined || value.selectionEnd === undefined || !value.selectedText)) {
    context.addIssue({ code: "custom", path: ["selectedText"], message: "Selection edit sessions require a complete selection." });
  }
  if (value.selectionStart !== undefined && value.selectionEnd !== undefined && value.selectionEnd <= value.selectionStart) {
    context.addIssue({ code: "custom", path: ["selectionEnd"], message: "Selection end must be after selection start." });
  }
});

export const GrantAiEditTurnSchema = z.object({
  turnId: UuidSchema,
  sessionId: UuidSchema,
  traceId: UuidSchema,
  basedOnCandidateId: UuidSchema.optional(),
  semanticBaseCandidateId: UuidSchema.optional(),
  instruction: z.string().trim().min(1).max(8000),
  status: z.enum(["running", "succeeded", "failed"]),
  failureCategory: z.string().optional(),
  createdAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
}).strict();

export const GrantAiEditCandidateSchema = z.object({
  candidateId: UuidSchema,
  sessionId: UuidSchema,
  producedByTurnId: UuidSchema,
  basedOnCandidateId: UuidSchema.optional(),
  semanticBaseCandidateId: UuidSchema.optional(),
  text: z.string().trim().min(1),
  textHash: Sha256Schema,
  safetyState: GrantAiEditSafetyStateSchema,
  factCheck: GrantAiEditFactCheckReportSchema,
  context: z.object({
    evidenceBindings: z.array(z.object({
      sourceId: UuidSchema, cardId: UuidSchema, authorizationRevision: z.number().int().positive(),
      sourceTitle: z.string().trim().min(1).max(500),
      provenanceType: z.enum(["published_literature", "own_unpublished_work", "project_material"]),
      sourceContentHash: Sha256Schema, excerptHash: Sha256Schema,
      uses: z.tuple([z.literal("model"), z.literal("reasoning")]),
    }).strict()),
    figureAuthorization: z.object({
      authorizationId: UuidSchema, authorizationRevision: z.number().int().positive(),
      sourceRevisionId: UuidSchema, assetIds: z.array(UuidSchema),
    }).strict().optional(),
  }).strict(),
  rationale: z.string().optional(),
  provider: z.literal("openai"),
  modelId: z.string().trim().min(1),
  createdAt: TimestampSchema,
}).strict();

export type GrantAiEditSession = z.infer<typeof GrantAiEditSessionSchema>;
export type GrantAiEditTurn = z.infer<typeof GrantAiEditTurnSchema>;
export type GrantAiEditCandidate = z.infer<typeof GrantAiEditCandidateSchema>;
export type GrantAiEditClaimBinding = z.infer<typeof GrantAiEditClaimBindingSchema>;
export type GrantAiEditFactCheckReport = z.infer<typeof GrantAiEditFactCheckReportSchema>;
