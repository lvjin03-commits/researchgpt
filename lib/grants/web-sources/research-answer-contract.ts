import { z } from "zod";
import type { GrantResearchGapComparison } from "./research-gap-comparison.ts";
import type { GrantResearchSourceGroup } from "./research-source-acquisition.ts";

const UuidSchema = z.string().uuid();

export const GrantResearchAnswerSelectionSchema = z.object({
  schemaVersion: z.literal(1),
  coreJudgment: z.string().trim().min(1).max(1200),
  selectedSourceGroupIds: z.array(UuidSchema).max(4),
}).strict();

export const GrantResearchRunTraceSchema = z.object({
  pipelineVersion: z.literal("research-grounding-v6"),
  featureFlags: z.object({
    structuredSources: z.boolean(),
    existingDesignCheck: z.boolean(),
    residualGapScopeFilter: z.boolean(),
    evidenceBasedSynthesis: z.boolean(),
  }).strict(),
  queryPlannerVersion: z.string().trim().min(1).max(100),
  sourceProviderVersions: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  evidenceContractVersion: z.string().trim().min(1).max(100),
  scopeFilterVersion: z.string().trim().min(1).max(100),
  synthesisPromptVersion: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]),
  legacyFallbackUsed: z.boolean(),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((trace, context) => {
  if (Date.parse(trace.completedAt) < Date.parse(trace.startedAt)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Research run cannot complete before it starts." });
  }
});

export type GrantResearchAnswer = {
  content: string;
  suggestions: Array<{
    number: number;
    sourceGroupId: string;
    residualGap: string;
    recommendation: string;
    sourceIds: string[];
  }>;
  sources: Array<{ sourceId: string; title: string; url: string; doi: string | null; evidenceOrigin: string }>;
  rejectedSuggestions: NonNullable<GrantResearchGapComparison["rejectedSuggestion"]>[];
  trace: z.infer<typeof GrantResearchRunTraceSchema>;
};

export function assembleGrantResearchAnswer(input: {
  selection: unknown;
  comparisons: readonly GrantResearchGapComparison[];
  sourceGroups: readonly GrantResearchSourceGroup[];
  trace: unknown;
}): GrantResearchAnswer {
  const selection = GrantResearchAnswerSelectionSchema.parse(input.selection);
  const trace = GrantResearchRunTraceSchema.parse(input.trace);
  const groups = new Map(input.sourceGroups.map((group) => [group.groupId, group]));
  if (groups.size !== input.sourceGroups.length) throw new Error("Research source groups must be unique.");
  const comparisons = new Map(input.comparisons.map((comparison) => [comparison.sourceGroupId, comparison]));
  if (comparisons.size !== input.comparisons.length) throw new Error("Research comparisons must be unique.");
  if (new Set(selection.selectedSourceGroupIds).size !== selection.selectedSourceGroupIds.length) {
    throw new Error("A research suggestion may be selected only once.");
  }

  const eligible = input.comparisons.filter((comparison) => comparison.disposition === "residual_gap_found"
    && comparison.scopeDecision.finalDecision !== "reject" && comparison.residualGap && comparison.recommendation);
  const requiredMain = new Set(eligible.filter((comparison) => comparison.scopeDecision.finalDecision === "main_suggestion")
    .map((comparison) => comparison.sourceGroupId));
  const selected = selection.selectedSourceGroupIds.map((sourceGroupId) => {
    const comparison = comparisons.get(sourceGroupId);
    if (!comparison || !eligible.includes(comparison)) throw new Error("Final answer selected a rejected or unavailable suggestion.");
    if (!groups.has(sourceGroupId)) throw new Error("Final answer selected a suggestion without a current source group.");
    return comparison;
  });
  if ([...requiredMain].some((id) => !selection.selectedSourceGroupIds.includes(id))) {
    throw new Error("Final answer omitted a program-approved main suggestion.");
  }

  const usedGroups = selected.map((comparison) => groups.get(comparison.sourceGroupId)!);
  const sourceMembers = usedGroups.flatMap((group) => group.members
    .filter((member) => member.record.sourceId === group.primarySourceId));
  const sources = sourceMembers.map((member) => ({
    sourceId: member.record.sourceId,
    title: member.record.title,
    url: member.record.canonicalUrl,
    doi: member.sourceKind === "structured_academic" ? member.record.publication.doi : null,
    evidenceOrigin: member.sourceKind === "structured_academic"
      ? member.record.evidence.kind === "abstract" ? member.record.evidence.origin : "metadata_only"
      : "search_excerpt",
  }));
  const suggestions = selected.map((comparison, index) => ({
    number: index + 1,
    sourceGroupId: comparison.sourceGroupId,
    residualGap: comparison.residualGap!,
    recommendation: comparison.recommendation!,
    sourceIds: [comparison.latestDevelopment.primarySourceId],
  }));
  const content = [
    `1. 核心判断：${selection.coreJudgment}`,
    ...suggestions.map((suggestion, index) => `${index + 2}. 补充建议${index + 1}：${suggestion.residualGap} ${suggestion.recommendation}`),
  ].join("\n\n");
  return {
    content,
    suggestions,
    sources,
    rejectedSuggestions: input.comparisons.flatMap((comparison) => comparison.rejectedSuggestion ? [comparison.rejectedSuggestion] : []),
    trace,
  };
}

