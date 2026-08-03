import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(160);
const TextSchema = z.string().trim().min(1).max(4_000);
const DateTimeSchema = z.iso.datetime({ offset: true });
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const ResearchExplorationPurposeSchema = z.enum([
  "literature_review",
  "grant_topic_exploration",
  "field_landscape",
  "technology_comparison",
]);

export const ResearchExplorationModeSchema = z.enum([
  "off",
  "advisory",
  "required",
]);

export const ResearchExplorationVersionSnapshotSchema = z
  .object({
    packageVersion: IdentifierSchema,
    adapterVersion: IdentifierSchema,
    outputContractVersion: IdentifierSchema,
    promptConfigurationVersion: IdentifierSchema,
  })
  .strict();

export const ResearchExplorationInputSchema = z
  .object({
    explorationId: IdentifierSchema,
    topic: z.string().trim().min(3).max(1_000),
    purpose: ResearchExplorationPurposeSchema,
    language: z.enum(["zh", "en"]),
    scope: z
      .object({
        timeRange: z
          .object({
            fromYear: z.number().int().min(1800).max(2200).optional(),
            toYear: z.number().int().min(1800).max(2200).optional(),
          })
          .strict()
          .superRefine((range, context) => {
            if (
              range.fromYear !== undefined &&
              range.toYear !== undefined &&
              range.fromYear > range.toYear
            ) {
              context.addIssue({
                code: "custom",
                path: ["fromYear"],
                message: "Research start year cannot be after the end year.",
              });
            }
          })
          .optional(),
        disciplines: z.array(TextSchema).max(20).default([]),
        excludedTopics: z.array(TextSchema).max(50).default([]),
      })
      .strict()
      .default({ disciplines: [], excludedTopics: [] }),
    sourcePolicy: z
      .object({
        useWeb: z.boolean(),
        useUserDocuments: z.boolean(),
        userResourceIds: z.array(IdentifierSchema).max(200),
      })
      .strict()
      .superRefine((policy, context) => {
        if (!policy.useWeb && !policy.useUserDocuments) {
          context.addIssue({
            code: "custom",
            message: "At least one research source must be enabled.",
          });
        }
        if (!policy.useUserDocuments && policy.userResourceIds.length > 0) {
          context.addIssue({
            code: "custom",
            path: ["userResourceIds"],
            message: "User resource IDs require useUserDocuments=true.",
          });
        }
      }),
    limits: z
      .object({
        maxPerspectives: z.number().int().min(1).max(12),
        maxQuestionsPerPerspective: z.number().int().min(1).max(12),
        maxSearchQueries: z.number().int().min(1).max(200),
        maxSources: z.number().int().min(1).max(500),
        maximumWallTimeMs: z.number().int().min(10_000).max(3_600_000),
        maximumModelCalls: z.number().int().min(1).max(500),
        maximumInspectionCount: z.number().int().min(1).max(100),
      })
      .strict(),
    modelProfile: z
      .object({
        provider: IdentifierSchema,
        model: IdentifierSchema,
        reasoningEffort: z.enum(["none", "low", "medium"]).default("none"),
      })
      .strict(),
    userResourceSnapshotHash: Sha256Schema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.sourcePolicy.useUserDocuments && !input.userResourceSnapshotHash) {
      context.addIssue({
        code: "custom",
        path: ["userResourceSnapshotHash"],
        message: "User-document exploration requires a frozen resource snapshot hash.",
      });
    }
  });

const PerspectiveCandidateSchema = z
  .object({
    perspectiveKey: IdentifierSchema,
    title: TextSchema,
    rationale: z.string().trim().min(1).max(8_000),
  })
  .strict();

const ResearchQuestionCandidateSchema = z
  .object({
    questionKey: IdentifierSchema,
    perspectiveKey: IdentifierSchema,
    question: TextSchema,
    importance: z.enum(["high", "medium", "low"]),
    followUpQuestions: z.array(TextSchema).max(20),
  })
  .strict();

const SearchPlanCandidateSchema = z
  .object({
    queryKey: IdentifierSchema,
    questionKey: IdentifierSchema,
    query: TextSchema,
    sourceType: z.enum(["web", "user_corpus"]),
  })
  .strict();

const SourceCandidateSchema = z
  .object({
    sourceCandidateKey: IdentifierSchema,
    title: TextSchema,
    url: z.url().optional(),
    doi: z.string().trim().min(3).max(300).optional(),
    authors: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
    year: z.number().int().min(1000).max(2200).optional(),
    snippet: z.string().trim().min(1).max(12_000).optional(),
    retrievedBy: IdentifierSchema,
  })
  .strict();

const KnowledgeNodeCandidateSchema = z
  .object({
    nodeKey: IdentifierSchema,
    title: TextSchema,
    summary: z.string().trim().min(1).max(12_000),
    parentNodeKey: IdentifierSchema.optional(),
    supportingSourceCandidateKeys: z.array(IdentifierSchema).max(100),
  })
  .strict();

const OutlineSectionCandidateSchema = z
  .object({
    heading: TextSchema,
    purpose: z.string().trim().min(1).max(8_000),
    questionKeys: z.array(IdentifierSchema).max(100),
    supportingSourceCandidateKeys: z.array(IdentifierSchema).max(100),
  })
  .strict();

const OutlineCandidateSchema = z
  .object({
    outlineKey: IdentifierSchema,
    title: TextSchema,
    sections: z.array(OutlineSectionCandidateSchema).min(1).max(40),
  })
  .strict();

function duplicateValues(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export const ResearchExplorationProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    explorationId: IdentifierSchema,
    status: z.enum(["complete", "partial", "failed"]),
    perspectives: z.array(PerspectiveCandidateSchema).max(20),
    researchQuestions: z.array(ResearchQuestionCandidateSchema).max(200),
    searchPlans: z.array(SearchPlanCandidateSchema).max(500),
    sourceCandidates: z.array(SourceCandidateSchema).max(1_000),
    knowledgeNodes: z.array(KnowledgeNodeCandidateSchema).max(1_000),
    outlineCandidates: z.array(OutlineCandidateSchema).max(20),
    unresolvedQuestions: z.array(TextSchema).max(200),
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(200),
    usage: z
      .object({
        modelCalls: z.number().int().nonnegative(),
        searchCalls: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        estimatedCostUsd: z.number().nonnegative().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((proposal, context) => {
    const keyedCollections = [
      ["perspectives", proposal.perspectives.map((item) => item.perspectiveKey)],
      ["researchQuestions", proposal.researchQuestions.map((item) => item.questionKey)],
      ["searchPlans", proposal.searchPlans.map((item) => item.queryKey)],
      ["sourceCandidates", proposal.sourceCandidates.map((item) => item.sourceCandidateKey)],
      ["knowledgeNodes", proposal.knowledgeNodes.map((item) => item.nodeKey)],
      ["outlineCandidates", proposal.outlineCandidates.map((item) => item.outlineKey)],
    ] as const;
    for (const [path, values] of keyedCollections) {
      for (const duplicate of duplicateValues(values)) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: `Duplicate candidate key: ${duplicate}`,
        });
      }
    }
    const perspectiveKeys = new Set(
      proposal.perspectives.map((item) => item.perspectiveKey),
    );
    const questionKeys = new Set(
      proposal.researchQuestions.map((item) => item.questionKey),
    );
    const sourceKeys = new Set(
      proposal.sourceCandidates.map((item) => item.sourceCandidateKey),
    );
    const knowledgeKeys = new Set(
      proposal.knowledgeNodes.map((item) => item.nodeKey),
    );
    proposal.researchQuestions.forEach((question, index) => {
      if (!perspectiveKeys.has(question.perspectiveKey)) {
        context.addIssue({
          code: "custom",
          path: ["researchQuestions", index, "perspectiveKey"],
          message: "Research question references an unknown perspective candidate.",
        });
      }
    });
    proposal.searchPlans.forEach((search, index) => {
      if (!questionKeys.has(search.questionKey)) {
        context.addIssue({
          code: "custom",
          path: ["searchPlans", index, "questionKey"],
          message: "Search plan references an unknown research question candidate.",
        });
      }
    });
    proposal.knowledgeNodes.forEach((node, index) => {
      if (node.parentNodeKey && !knowledgeKeys.has(node.parentNodeKey)) {
        context.addIssue({
          code: "custom",
          path: ["knowledgeNodes", index, "parentNodeKey"],
          message: "Knowledge node references an unknown parent candidate.",
        });
      }
      node.supportingSourceCandidateKeys.forEach((sourceKey) => {
        if (!sourceKeys.has(sourceKey)) {
          context.addIssue({
            code: "custom",
            path: ["knowledgeNodes", index, "supportingSourceCandidateKeys"],
            message: `Knowledge node references unknown source candidate '${sourceKey}'.`,
          });
        }
      });
    });
    proposal.outlineCandidates.forEach((outline, outlineIndex) => {
      outline.sections.forEach((section, sectionIndex) => {
        section.questionKeys.forEach((questionKey) => {
          if (!questionKeys.has(questionKey)) {
            context.addIssue({
              code: "custom",
              path: ["outlineCandidates", outlineIndex, "sections", sectionIndex, "questionKeys"],
              message: `Outline references unknown question candidate '${questionKey}'.`,
            });
          }
        });
        section.supportingSourceCandidateKeys.forEach((sourceKey) => {
          if (!sourceKeys.has(sourceKey)) {
            context.addIssue({
              code: "custom",
              path: [
                "outlineCandidates",
                outlineIndex,
                "sections",
                sectionIndex,
                "supportingSourceCandidateKeys",
              ],
              message: `Outline references unknown source candidate '${sourceKey}'.`,
            });
          }
        });
      });
    });
    if (
      proposal.status === "complete" &&
      (proposal.perspectives.length === 0 ||
        proposal.researchQuestions.length === 0 ||
        proposal.outlineCandidates.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "A complete exploration requires perspectives, questions, and an outline candidate.",
      });
    }
  });

export const ResearchExplorationStatusSchema = z.enum([
  "queued",
  "running",
  "partial",
  "complete",
  "failed",
  "unknown_outcome",
  "expired",
  "cancelled",
]);

export const ResearchExplorationFailureSchema = z
  .object({
    code: IdentifierSchema,
    category: z.enum(["contract", "provider", "infrastructure", "unknown_outcome"]),
    retryability: z.enum(["none", "safe", "unknown"]),
    technicalMessage: z.string().trim().min(1).max(8_000),
    userMessageCode: IdentifierSchema,
  })
  .strict();

export const ResearchExplorationExecutionSchema = z
  .object({
    schemaVersion: z.literal(1),
    executionId: z.uuid(),
    explorationId: IdentifierSchema,
    explorationRevision: z.number().int().positive(),
    executionRevision: z.number().int().nonnegative(),
    jobId: z.uuid().optional(),
    contextRevision: z.number().int().nonnegative().optional(),
    requirement: z.enum(["optional", "required"]),
    adapter: z.literal("storm"),
    versions: ResearchExplorationVersionSnapshotSchema,
    inputFingerprint: Sha256Schema,
    status: ResearchExplorationStatusSchema,
    remoteExecutionId: IdentifierSchema.optional(),
    resultLocation: z.string().trim().min(1).max(2_000).optional(),
    nextCheckAt: DateTimeSchema.optional(),
    inspectionCount: z.number().int().nonnegative(),
    maximumInspectionCount: z.number().int().positive(),
    expiresAt: DateTimeSchema,
    failure: ResearchExplorationFailureSchema.optional(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict()
  .superRefine((execution, context) => {
    if (execution.inspectionCount > execution.maximumInspectionCount) {
      context.addIssue({
        code: "custom",
        path: ["inspectionCount"],
        message: "Inspection count exceeds the frozen maximum.",
      });
    }
    if (
      ["running", "partial", "complete"].includes(execution.status) &&
      !execution.remoteExecutionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["remoteExecutionId"],
        message: "Remote execution ID is required after the provider accepts a task.",
      });
    }
    if (["partial", "complete"].includes(execution.status) && !execution.resultLocation) {
      context.addIssue({
        code: "custom",
        path: ["resultLocation"],
        message: "Completed or partial exploration requires a durable result location.",
      });
    }
    if (["failed", "unknown_outcome"].includes(execution.status) && !execution.failure) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "Failed or unknown exploration requires structured failure evidence.",
      });
    }
  });

export type ResearchExplorationInput = z.infer<typeof ResearchExplorationInputSchema>;
export type ResearchExplorationProposal = z.infer<typeof ResearchExplorationProposalSchema>;
export type ResearchExplorationStatus = z.infer<typeof ResearchExplorationStatusSchema>;
export type ResearchExplorationExecution = z.infer<typeof ResearchExplorationExecutionSchema>;
export type ResearchExplorationVersionSnapshot = z.infer<
  typeof ResearchExplorationVersionSnapshotSchema
>;
