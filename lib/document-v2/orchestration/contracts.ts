import { z } from "zod";
import {
  FigureAssetSchema,
  FigureRequestDraftSchema,
} from "../assets/contracts";
import {
  ApprovedDocumentBlockSchema,
  DocumentPlanSchema,
  DocumentRequestSchema,
  FinalDocumentSpecSchema,
  VerifiedReferenceSchema,
} from "../contracts";

const IdentifierSchema = z.string().min(1).max(120);

export const EvidenceSnippetSchema = z
  .object({
    evidenceId: IdentifierSchema,
    excerpt: z.string().trim().min(1).max(20_000),
    locator: z
      .object({
        page: z.number().int().positive().optional(),
        section: z.string().trim().min(1).max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const GeneratedBlockDraftSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("heading"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("paragraph"),
      role: z.enum(["abstract", "body", "conclusion"]),
      text: z.string().trim().min(1),
      citationIds: z.array(IdentifierSchema),
      figureRequestIndexes: z
        .array(z.number().int().min(0).max(99))
        .default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal("keywords"),
      values: z.array(z.string().trim().min(1).max(100)).min(3).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("table"),
      caption: z.string().trim().min(1),
      columns: z.array(z.string().trim().min(1)).min(1),
      rows: z.array(z.array(z.string())).min(1),
    })
    .strict()
    .superRefine((table, context) => {
      table.rows.forEach((row, index) => {
        if (row.length !== table.columns.length) {
          context.addIssue({
            code: "custom",
            path: ["rows", index],
            message: "Every table row must match the column count.",
          });
        }
      });
    }),
]);

export type GeneratedBlockDraft = z.infer<typeof GeneratedBlockDraftSchema>;

export const GeneratedComponentPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("title"),
      title: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocks"),
      blocks: z.array(GeneratedBlockDraftSchema).min(1).max(500),
      figureRequests: z.array(FigureRequestDraftSchema).max(100).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("references"),
      referenceIds: z.array(IdentifierSchema).max(500),
    })
    .strict(),
]);

export type GeneratedComponentPayload = z.infer<
  typeof GeneratedComponentPayloadSchema
>;

export const ComponentValidationResultSchema = z.discriminatedUnion(
  "accepted",
  [
    z.object({ accepted: z.literal(true) }).strict(),
    z
      .object({
        accepted: z.literal(false),
        code: IdentifierSchema,
        feedback: z.string().trim().min(1).max(2_000),
      })
      .strict(),
  ],
);

export type ComponentValidationResult = z.infer<
  typeof ComponentValidationResultSchema
>;

const ApprovedComponentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("title"),
      title: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("blocks"),
      blocks: z.array(ApprovedDocumentBlockSchema).min(1).max(500),
      assets: z.array(FigureAssetSchema).max(100).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("references"),
      referenceIds: z.array(IdentifierSchema).max(500),
    })
    .strict(),
]);

export type ApprovedComponent = z.infer<typeof ApprovedComponentSchema>;

const ComponentRevisionSchema = z
  .object({
    revision: z.number().int().positive(),
    status: z.enum(["approved", "superseded"]),
    content: ApprovedComponentSchema,
    dependencyVersions: z.record(IdentifierSchema, z.number().int().positive()),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/i),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export const ComponentExecutionStateSchema = z
  .object({
    componentKey: IdentifierSchema,
    status: z.enum(["pending", "running", "approved", "stale", "failed"]),
    attempts: z.number().int().min(0).max(100),
    transientFailures: z.number().int().min(0).max(100).default(0),
    lastError: z
      .object({
        code: IdentifierSchema,
        message: z.string().trim().min(1).max(4_000),
      })
      .strict()
      .optional(),
    approved: ApprovedComponentSchema.optional(),
    revisions: z.array(ComponentRevisionSchema).default([]),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.status === "approved" && !state.approved) {
      context.addIssue({
        code: "custom",
        path: ["approved"],
        message: "Approved component state requires approved content.",
      });
    }
    if (state.status !== "approved" && state.approved) {
      context.addIssue({
        code: "custom",
        path: ["approved"],
        message: "Only approved component state may contain approved content.",
      });
    }
    const approvedRevisions = state.revisions.filter(
      (revision) => revision.status === "approved",
    );
    if (approvedRevisions.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["revisions"],
        message: "Only one component revision may be current.",
      });
    }
    if (state.status === "failed" && !state.lastError) {
      context.addIssue({
        code: "custom",
        path: ["lastError"],
        message: "Failed component state requires an error.",
      });
    }
  });

export type ComponentExecutionState = z.infer<
  typeof ComponentExecutionStateSchema
>;

export const OrchestrationEventSchema = z
  .object({
    sequence: z.number().int().min(1),
    type: z.enum([
      "job_started",
      "component_started",
      "component_rejected",
      "component_approved",
      "job_paused",
      "job_failed",
      "job_completed",
    ]),
    componentKey: IdentifierSchema.optional(),
    attempt: z.number().int().min(1).optional(),
    code: IdentifierSchema.optional(),
    message: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export type OrchestrationEvent = z.infer<typeof OrchestrationEventSchema>;

export const DocumentOrchestrationStateSchema = z
  .object({
    jobId: z.uuid(),
    schemaVersion: z.literal(1),
    request: DocumentRequestSchema,
    plan: DocumentPlanSchema,
    verifiedReferences: z.array(VerifiedReferenceSchema).max(500),
    evidenceBundle: z.array(EvidenceSnippetSchema).max(2_000).default([]),
    status: z.enum(["pending", "running", "paused", "completed", "failed"]),
    currentComponentIndex: z.number().int().min(0),
    components: z.array(ComponentExecutionStateSchema).min(1),
    events: z.array(OrchestrationEventSchema),
    finalSpec: FinalDocumentSpecSchema.optional(),
    failure: z
      .object({
        code: IdentifierSchema,
        message: z.string().trim().min(1).max(4_000),
        componentKey: IdentifierSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.request.requestId !== state.plan.requestId) {
      context.addIssue({
        code: "custom",
        path: ["plan", "requestId"],
        message: "Request and plan IDs must match.",
      });
    }
    if (state.components.length !== state.plan.components.length) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: "Execution state must contain every planned component.",
      });
    }
    state.components.forEach((component, index) => {
      if (component.componentKey !== state.plan.components[index]?.componentKey) {
        context.addIssue({
          code: "custom",
          path: ["components", index, "componentKey"],
          message: "Execution component order must match the plan.",
        });
      }
    });
    if (state.status === "completed" && !state.finalSpec) {
      context.addIssue({
        code: "custom",
        path: ["finalSpec"],
        message: "Completed orchestration requires a final document spec.",
      });
    }
    if (state.status !== "completed" && state.finalSpec) {
      context.addIssue({
        code: "custom",
        path: ["finalSpec"],
        message: "Only completed orchestration may contain a final spec.",
      });
    }
    if (state.status === "failed" && !state.failure) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Failed orchestration requires failure details.",
      });
    }
  });

export type DocumentOrchestrationState = z.infer<
  typeof DocumentOrchestrationStateSchema
>;
