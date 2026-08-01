import { z } from "zod";
import { DocumentOrchestrationStateSchema } from "../orchestration/contracts";
import { DocumentRequestSchema, VerifiedReferenceSchema } from "../contracts";
import { TemplateResolutionSchema } from "../templates/contracts";
import { DocumentSkeletonSchema, SectionPlanSchema } from "../planning/contracts";

const IdentifierSchema = z.string().trim().min(1).max(120);
const DateTimeSchema = z.iso.datetime({ offset: true });

export const DocumentTextExecutionProfileSchema = z
  .object({
    provider: z.enum(["deepseek", "openai"]),
    requestedModelId: IdentifierSchema,
    resolvedModelId: IdentifierSchema,
    maxOutputTokens: z.number().int().min(500).max(32_000),
    reasoningEffort: z.enum(["none", "low", "medium"]).default("none"),
    allowProviderFallback: z.literal(false),
  })
  .strict();

export type DocumentTextExecutionProfile = z.infer<
  typeof DocumentTextExecutionProfileSchema
>;

export const DocumentModelCapabilitySnapshotSchema = z
  .object({
    provider: z.enum(["deepseek", "openai"]),
    requestedModelId: IdentifierSchema,
    resolvedModelId: IdentifierSchema,
    maxOutputTokens: z.number().int().min(500).max(32_000),
    capabilityVersion: IdentifierSchema,
  })
  .strict();

export const DocumentOperationBudgetSchema = z
  .object({
    expectedOutputTokens: z.number().int().min(1).max(32_000),
    preferredMaxOutputTokens: z.number().int().min(500).max(32_000),
    hardMaxOutputTokens: z.number().int().min(500).max(32_000),
    effectivePreferredMaxOutputTokens: z.number().int().min(500).max(32_000),
    effectiveHardMaxOutputTokens: z.number().int().min(500).max(32_000),
    escalationAllowed: z.boolean(),
    reasoningPolicy: z.enum(["inherit", "none", "low", "medium"]).default("inherit"),
  })
  .strict()
  .superRefine((budget, context) => {
    if (budget.preferredMaxOutputTokens > budget.hardMaxOutputTokens) {
      context.addIssue({
        code: "custom",
        path: ["preferredMaxOutputTokens"],
        message: "Preferred output budget cannot exceed the hard budget.",
      });
    }
    if (
      budget.effectivePreferredMaxOutputTokens >
      budget.effectiveHardMaxOutputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectivePreferredMaxOutputTokens"],
        message: "Effective preferred budget cannot exceed the effective hard budget.",
      });
    }
  });

export const DocumentExecutionBudgetSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    modelCapability: DocumentModelCapabilitySnapshotSchema,
    productBudgetPolicyVersion: IdentifierSchema,
    operationBudgetPolicyVersion: IdentifierSchema,
    productBudgetMode: z.literal("observe_only"),
    productMaxOutputTokensPerOperation: z.number().int().min(500).max(32_000),
    effectiveBudgets: z.record(IdentifierSchema, DocumentOperationBudgetSchema),
    frozenAt: DateTimeSchema,
  })
  .strict();

export type DocumentExecutionBudgetSnapshot = z.infer<
  typeof DocumentExecutionBudgetSnapshotSchema
>;

export const DocumentEvidenceItemSchema = z
  .object({
    evidenceId: IdentifierSchema,
    reference: VerifiedReferenceSchema,
    excerpt: z.string().trim().min(1).max(20_000),
    locator: z
      .object({
        page: z.number().int().positive().optional(),
        section: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.evidenceId !== item.reference.id) {
      context.addIssue({
        code: "custom",
        path: ["evidenceId"],
        message: "Evidence ID must equal its verified reference ID.",
      });
    }
  });

export const DocumentJobBudgetSchema = z
  .object({
    maxModelCalls: z.number().int().positive(),
    maxImageCalls: z.number().int().nonnegative(),
    maxImageAssets: z.number().int().nonnegative().default(0),
    maxRepairAttempts: z.number().int().nonnegative(),
    maxExecutionMs: z.number().int().positive(),
    usedModelCalls: z.number().int().nonnegative(),
    usedImageCalls: z.number().int().nonnegative(),
    completedImageAssets: z.number().int().nonnegative().default(0),
    usedRepairAttempts: z.number().int().nonnegative(),
    usedExecutionMs: z.number().int().nonnegative(),
  })
  .strict();

export const DocumentExecutionSnapshotSchema = z
  .object({
    requestSchemaVersion: z.literal("1"),
    planSchemaVersion: z.literal("1"),
    finalSpecSchemaVersion: z.literal("1"),
    intentPromptVersion: IdentifierSchema,
    plannerPromptVersion: IdentifierSchema,
    generatorPromptVersion: IdentifierSchema,
    validatorVersion: IdentifierSchema,
    modelProvider: IdentifierSchema,
    modelId: IdentifierSchema,
    rendererVersion: IdentifierSchema,
    templateChecksum: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    evidenceSnapshotId: IdentifierSchema.optional(),
  })
  .strict();

export const DocumentJobStageSchema = z.enum([
  "intake",
  "understanding",
  "evidence_acquisition",
  "queued",
  "template_resolution",
  "planning",
  "content_generation",
  "asset_generation",
  "document_assembly",
  "docx_rendering",
  "quality_check",
  "artifact_storage",
  "completed",
]);

export type DocumentJobStage = z.infer<typeof DocumentJobStageSchema>;

export const DocumentJobStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "awaiting_user_input",
  "retry_wait",
  "budget_exhausted",
  "dead_letter",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
]);

export type DocumentJobStatus = z.infer<typeof DocumentJobStatusSchema>;

export const DocumentJobEventSchema = z
  .object({
    eventId: z.uuid(),
    jobId: z.uuid(),
    sequence: z.number().int().positive(),
    stage: DocumentJobStageSchema,
    status: z.enum([
      "started",
      "progress",
      "retrying",
      "succeeded",
      "failed",
      "paused",
      "cancelled",
    ]),
    message: z.string().trim().min(1).max(500),
    category: z
      .enum([
        "lifecycle",
        "dispatch",
        "model",
        "validation",
        "image",
        "render",
        "storage",
        "recovery",
      ])
      .optional(),
    operation: IdentifierSchema.optional(),
    correlationId: IdentifierSchema.optional(),
    metadata: z
      .record(
        z.string().min(1).max(120),
        z.union([
          z.string().max(2_000),
          z.number(),
          z.boolean(),
          z.null(),
        ]),
      )
      .optional(),
    componentKey: IdentifierSchema.optional(),
    attempt: z.number().int().positive().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorCode: IdentifierSchema.optional(),
    technicalMessage: z.string().trim().min(1).max(2_000).optional(),
    createdAt: DateTimeSchema,
  })
  .strict();

export type DocumentJobEvent = z.infer<typeof DocumentJobEventSchema>;

export const DocumentJobCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    intake: z
      .object({
        instruction: z.string().trim().min(1).max(8_000),
        source: z
          .object({
            kind: z.enum(["prompt", "previous_message", "attachments", "existing_document"]),
            sourceIds: z.array(IdentifierSchema).max(100),
          })
          .strict(),
        language: z.enum(["zh", "en"]).optional(),
        targetLength: z.number().int().min(100).max(100_000).optional(),
        verifiedReferences: z.array(VerifiedReferenceSchema).max(500),
        evidence: z.array(DocumentEvidenceItemSchema).max(2_000).default([]),
      })
      .strict()
      .optional(),
    planning: z
      .object({
        schemaVersion: z.literal(1),
        planningRevision: z.number().int().positive().default(1),
        request: DocumentRequestSchema,
        template: TemplateResolutionSchema,
        evidenceReferences: z.array(VerifiedReferenceSchema).max(500),
        evidenceSnapshotId: IdentifierSchema.optional(),
        thesis: z
          .object({
            reviewThesis: z.string().trim().min(1).max(1_200),
            scopeBoundary: z.string().trim().min(1).max(1_200),
            reviewQuestions: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
            conclusionHeading: z.string().trim().min(1).max(300),
          })
          .strict()
          .optional(),
        planningMigration: z
          .object({
            supersededOperation: z.literal("outline.structure"),
            replacementOperations: z.tuple([
              z.literal("outline.thesis"),
              z.literal("outline.section_index"),
            ]),
            reason: IdentifierSchema,
            migratedAt: DateTimeSchema,
          })
          .strict()
          .optional(),
        skeleton: DocumentSkeletonSchema.optional(),
        figureIntentsCompleted: z.boolean().default(false),
        sectionPlans: z.array(SectionPlanSchema).max(100),
      })
      .strict()
      .optional(),
    orchestration: DocumentOrchestrationStateSchema.optional(),
    clarification: z
      .object({
        questionId: z.uuid(),
        field: IdentifierSchema,
        question: z.string().trim().min(1).max(500),
        reason: z.string().trim().min(1).max(500),
        required: z.boolean(),
      })
      .strict()
      .optional(),
    executionSnapshot: DocumentExecutionSnapshotSchema.optional(),
    textExecution: DocumentTextExecutionProfileSchema.optional(),
    executionBudget: DocumentExecutionBudgetSnapshotSchema.optional(),
    dispatchToken: z.string().min(32).max(200).optional(),
    budget: DocumentJobBudgetSchema.optional(),
    renderedArtifactId: IdentifierSchema.optional(),
    recoveryAttempt: z.number().int().nonnegative().default(0),
    savedAt: DateTimeSchema,
  })
  .strict();

export type DocumentJobCheckpoint = z.infer<
  typeof DocumentJobCheckpointSchema
>;

export const DocumentJobSchema = z
  .object({
    jobId: z.uuid(),
    ownerId: IdentifierSchema,
    pipelineVersion: z.literal("document-v2"),
    status: DocumentJobStatusSchema,
    stage: DocumentJobStageSchema,
    progress: z.number().int().min(0).max(100),
    currentComponentKey: IdentifierSchema.optional(),
    completedComponents: z.number().int().nonnegative(),
    totalComponents: z.number().int().nonnegative(),
    cancelRequestedAt: DateTimeSchema.optional(),
    resumable: z.boolean(),
    leaseOwner: IdentifierSchema.optional(),
    leaseExpiresAt: DateTimeSchema.optional(),
    error: z
      .object({
        code: IdentifierSchema,
        userMessage: z.string().trim().min(1).max(500),
        technicalMessage: z.string().trim().min(1).max(2_000),
        failedStage: DocumentJobStageSchema,
        componentKey: IdentifierSchema.optional(),
      })
      .strict()
      .optional(),
    clarification: z
      .object({
        questionId: z.uuid(),
        field: IdentifierSchema,
        question: z.string().trim().min(1).max(500),
        reason: z.string().trim().min(1).max(500),
        required: z.boolean(),
      })
      .strict()
      .optional(),
    artifactId: IdentifierSchema.optional(),
    checkpoint: DocumentJobCheckpointSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    startedAt: DateTimeSchema.optional(),
    finishedAt: DateTimeSchema.optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.completedComponents > job.totalComponents) {
      context.addIssue({
        code: "custom",
        path: ["completedComponents"],
        message: "Completed components cannot exceed total components.",
      });
    }
    if (!job.checkpoint.intake && !job.checkpoint.orchestration) {
      context.addIssue({
        code: "custom",
        path: ["checkpoint"],
        message: "A job requires intake data or an orchestration checkpoint.",
      });
    }
    if (job.status === "completed" && !job.artifactId) {
      context.addIssue({
        code: "custom",
        path: ["artifactId"],
        message: "A completed job requires an artifact.",
      });
    }
    if (job.status === "failed" && !job.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "A failed job requires error details.",
      });
    }
    if (!["failed", "paused"].includes(job.status) && job.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Only a failed or paused job may contain error details.",
      });
    }
  });

export type DocumentJob = z.infer<typeof DocumentJobSchema>;

const { checkpoint: _privateCheckpoint, ...PublicDocumentJobShape } =
  DocumentJobSchema.shape;

export const DocumentJobSnapshotSchema = z
  .object({
    job: z.object(PublicDocumentJobShape).strict(),
    events: z.array(DocumentJobEventSchema),
  })
  .strict();

export type DocumentJobSnapshot = z.infer<typeof DocumentJobSnapshotSchema>;

export const STAGE_LABELS: Record<DocumentJobStage, string> = {
  intake: "任务已创建",
  understanding: "正在理解文档要求",
  evidence_acquisition: "正在准备可信资料",
  queued: "等待开始",
  template_resolution: "正在选择文档模板",
  planning: "正在规划文档结构",
  content_generation: "正在撰写文档内容",
  asset_generation: "正在生成图片和图表",
  document_assembly: "正在组装文档",
  docx_rendering: "正在排版 Word 文档",
  quality_check: "正在检查文档质量",
  artifact_storage: "正在保存文件",
  completed: "文件已生成",
};

export function publicJobSnapshot(
  job: DocumentJob,
  events: DocumentJobEvent[],
): DocumentJobSnapshot {
  const { checkpoint: _checkpoint, ...publicJob } = job;
  return DocumentJobSnapshotSchema.parse({ job: publicJob, events });
}
