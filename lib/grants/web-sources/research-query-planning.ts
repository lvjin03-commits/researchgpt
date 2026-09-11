import { z } from "zod";

export const GrantResearchQueryDimensionSchema = z.enum([
  "recent_review",
  "mechanism",
  "quantitative_performance",
  "dynamic_interface",
  "application_specific",
]);
export type GrantResearchQueryDimension = z.infer<typeof GrantResearchQueryDimensionSchema>;

export const GrantResearchQueryPlanProviderV1Schema = z.object({
  schemaVersion: z.literal(1),
  queries: z.array(z.object({
    queryRef: z.string().regex(/^Q[1-5]$/u),
    dimension: GrantResearchQueryDimensionSchema,
    query: z.string().trim().min(2).max(160),
    purpose: z.string().trim().min(1).max(500),
  }).strict()).min(3).max(5),
}).strict();

export type GrantResearchQueryPlan = {
  schemaVersion: 1;
  queries: Array<{
    queryId: string;
    dimension: GrantResearchQueryDimension;
    query: string;
    purpose: string;
  }>;
};

function normalizedQuery(query: string): string {
  return query.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function assembleGrantResearchQueryPlan(input: {
  providerResult: unknown;
  createId: () => string;
}): GrantResearchQueryPlan {
  const provider = GrantResearchQueryPlanProviderV1Schema.parse(input.providerResult);
  const refs = provider.queries.map((query) => query.queryRef);
  if (new Set(refs).size !== refs.length) throw new Error("Research query references must be unique.");
  if (refs.some((ref, index) => ref !== `Q${index + 1}`)) throw new Error("Research query references must be contiguous and ordered.");
  const normalized = provider.queries.map((query) => normalizedQuery(query.query));
  if (new Set(normalized).size !== normalized.length) throw new Error("Research queries must be textually distinct.");
  const dimensions = new Set(provider.queries.map((query) => query.dimension));
  if (!dimensions.has("recent_review") || !dimensions.has("application_specific")) {
    throw new Error("Research query plans require recent-review and application-specific coverage.");
  }
  if (!["mechanism", "quantitative_performance", "dynamic_interface"].some((dimension) => dimensions.has(dimension as GrantResearchQueryDimension))) {
    throw new Error("Research query plans require at least one mechanism or performance dimension.");
  }
  return {
    schemaVersion: 1,
    queries: provider.queries.map(({ queryRef: _queryRef, ...query }) => ({
      ...query,
      queryId: z.string().uuid().parse(input.createId()),
    })),
  };
}

export type GrantResearchEvidenceCoverage = {
  dimension: GrantResearchQueryDimension;
  executed: boolean;
  recommendedSourceCount: number;
  structuredAbstractCount: number;
  recentSourceCount: number;
  quantitativeFindingCount: number;
  comparisonComplete: boolean;
};

export type GrantResearchNextStepDecision =
  | { decision: "execute_query"; query: GrantResearchQueryPlan["queries"][number]; reason: "coverage_incomplete" }
  | { decision: "stop"; reason: "evidence_sufficient" | "plan_exhausted"; limitations: string[] };

const RequiredDimensions: readonly GrantResearchQueryDimension[] = ["recent_review", "application_specific"];

function validateCoverage(input: readonly GrantResearchEvidenceCoverage[]) {
  const seen = new Set<GrantResearchQueryDimension>();
  for (const coverage of input) {
    GrantResearchQueryDimensionSchema.parse(coverage.dimension);
    if (seen.has(coverage.dimension)) throw new Error("Research evidence coverage dimensions must be unique.");
    seen.add(coverage.dimension);
    for (const value of [coverage.recommendedSourceCount, coverage.structuredAbstractCount,
      coverage.recentSourceCount, coverage.quantitativeFindingCount]) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("Research evidence coverage counts must be non-negative safe integers.");
    }
    if (!coverage.executed && (coverage.recommendedSourceCount > 0 || coverage.structuredAbstractCount > 0
      || coverage.recentSourceCount > 0 || coverage.quantitativeFindingCount > 0 || coverage.comparisonComplete)) {
      throw new Error("An unexecuted research dimension cannot report evidence coverage.");
    }
  }
}

export function decideGrantResearchNextStep(input: {
  plan: GrantResearchQueryPlan;
  completedQueryIds: readonly string[];
  coverage: readonly GrantResearchEvidenceCoverage[];
}): GrantResearchNextStepDecision {
  validateCoverage(input.coverage);
  const plannedIds = new Set(input.plan.queries.map((query) => query.queryId));
  if (new Set(input.completedQueryIds).size !== input.completedQueryIds.length
    || input.completedQueryIds.some((id) => !plannedIds.has(id))) {
    throw new Error("Completed research queries must be unique members of the current plan.");
  }
  const executedCoverage = input.coverage.filter((item) => item.executed);
  const totalRecommended = executedCoverage.reduce((sum, item) => sum + item.recommendedSourceCount, 0);
  const totalAbstracts = executedCoverage.reduce((sum, item) => sum + item.structuredAbstractCount, 0);
  const totalRecent = executedCoverage.reduce((sum, item) => sum + item.recentSourceCount, 0);
  const totalQuantitative = executedCoverage.reduce((sum, item) => sum + item.quantitativeFindingCount, 0);
  const requiredCovered = RequiredDimensions.every((dimension) => executedCoverage.some((item) => item.dimension === dimension
    && item.recommendedSourceCount > 0 && item.structuredAbstractCount > 0 && item.comparisonComplete));
  const scientificDepthCovered = executedCoverage.some((item) => ["mechanism", "dynamic_interface", "quantitative_performance"].includes(item.dimension)
    && item.recommendedSourceCount > 0 && item.structuredAbstractCount > 0 && item.comparisonComplete);
  if (input.completedQueryIds.length >= 3 && requiredCovered && scientificDepthCovered
    && totalRecommended >= 5 && totalAbstracts >= 3 && totalRecent >= 2 && totalQuantitative >= 1) {
    return { decision: "stop", reason: "evidence_sufficient", limitations: [] };
  }

  const completed = new Set(input.completedQueryIds);
  const next = input.plan.queries.find((query) => !completed.has(query.queryId));
  if (next) return { decision: "execute_query", query: next, reason: "coverage_incomplete" };
  const limitations = [
    ...(requiredCovered ? [] : ["Required recent-review or application-specific evidence remains incomplete."]),
    ...(scientificDepthCovered ? [] : ["Mechanism or quantitative evidence remains incomplete."]),
    ...(totalRecommended >= 5 ? [] : ["Fewer than five relevant sources were validated."]),
    ...(totalAbstracts >= 3 ? [] : ["Fewer than three structured abstracts were available."]),
    ...(totalRecent >= 2 ? [] : ["Fewer than two recent sources were validated."]),
    ...(totalQuantitative >= 1 ? [] : ["No source-supported quantitative finding was validated."]),
  ];
  return { decision: "stop", reason: "plan_exhausted", limitations };
}

