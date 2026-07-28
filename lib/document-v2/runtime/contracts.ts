import { z } from "zod";
import { DocumentOrchestrationStateSchema } from "../orchestration/contracts";

const IdentifierSchema = z.string().trim().min(1).max(120);

export const DocumentJobStageSchema = z.enum([
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
    componentKey: IdentifierSchema.optional(),
    attempt: z.number().int().positive().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorCode: IdentifierSchema.optional(),
    technicalMessage: z.string().trim().min(1).max(2_000).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();

export type DocumentJobEvent = z.infer<typeof DocumentJobEventSchema>;

export const DocumentJobCheckpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    orchestration: DocumentOrchestrationStateSchema,
    renderedArtifactId: IdentifierSchema.optional(),
    savedAt: z.iso.datetime(),
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
    totalComponents: z.number().int().positive(),
    cancelRequestedAt: z.iso.datetime().optional(),
    resumable: z.boolean(),
    leaseOwner: IdentifierSchema.optional(),
    leaseExpiresAt: z.iso.datetime().optional(),
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
    artifactId: IdentifierSchema.optional(),
    checkpoint: DocumentJobCheckpointSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    startedAt: z.iso.datetime().optional(),
    finishedAt: z.iso.datetime().optional(),
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
    if (job.status !== "failed" && job.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "Only a failed job may contain a terminal error.",
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
