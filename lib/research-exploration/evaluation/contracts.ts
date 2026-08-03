import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(160);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const ResearchExplorationShadowBaselineSchema = z
  .object({
    baselineId: IdentifierSchema,
    baselineRevision: z.number().int().nonnegative(),
    topic: z.string().trim().min(3).max(1_000),
    sectionHeadings: z.array(z.string().trim().min(1).max(4_000)).max(40),
    researchQuestions: z.array(z.string().trim().min(1).max(4_000)).max(200),
  })
  .strict();

export const ResearchExplorationShadowMetricsSchema = z
  .object({
    proposedPerspectiveCount: z.number().int().nonnegative(),
    proposedQuestionCount: z.number().int().nonnegative(),
    proposedOutlineSectionCount: z.number().int().nonnegative(),
    novelOutlineSectionCount: z.number().int().nonnegative(),
    baselineHeadingCoverageRatio: z.number().min(0).max(1),
    sourceCandidateCount: z.number().int().nonnegative(),
    sourceUrlAvailabilityRatio: z.number().min(0).max(1),
    duplicateSourceRatio: z.number().min(0).max(1),
    unresolvedQuestionCount: z.number().int().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    searchCalls: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().optional(),
  })
  .strict();

export const ResearchExplorationShadowEvaluationSchema = z
  .object({
    schemaVersion: z.literal(1),
    evaluationId: z.uuid(),
    explorationId: IdentifierSchema,
    explorationRevision: z.number().int().positive(),
    baselineId: IdentifierSchema,
    baselineRevision: z.number().int().nonnegative(),
    baselineFingerprint: Sha256Schema,
    proposalStatus: z.enum(["complete", "partial", "failed"]),
    metrics: ResearchExplorationShadowMetricsSchema,
    warnings: z.array(z.string().trim().min(1).max(4_000)).max(200),
    evaluatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type ResearchExplorationShadowBaseline = z.infer<
  typeof ResearchExplorationShadowBaselineSchema
>;
export type ResearchExplorationShadowMetrics = z.infer<
  typeof ResearchExplorationShadowMetricsSchema
>;
export type ResearchExplorationShadowEvaluation = z.infer<
  typeof ResearchExplorationShadowEvaluationSchema
>;
