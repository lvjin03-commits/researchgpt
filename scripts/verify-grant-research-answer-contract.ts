import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createGrantAcademicSourceRecord } from "../lib/grants/web-sources/academic-source-record.ts";
import { assembleGrantResearchAnswer } from "../lib/grants/web-sources/research-answer-contract.ts";
import { composeGrantResearchSources } from "../lib/grants/web-sources/research-source-acquisition.ts";
import type { GrantResearchGapComparison } from "../lib/grants/web-sources/research-gap-comparison.ts";

const academic = createGrantAcademicSourceRecord({ sourceId: randomUUID(), retrievedAt: "2026-09-14T12:00:00.000Z", result: {
  providerId: "openalex", providerRecordId: "W1234567890", url: "https://openalex.org/W1234567890",
  title: "Dynamic zinc solvation", abstract: "An applied field changes zinc solvation.", publicationYear: 2026,
  publicationDate: "2026-04-01", doi: "https://doi.org/10.1000/zinc", venue: "Example Journal",
  authors: ["A. Researcher"], retracted: false,
} });
const [group] = composeGrantResearchSources({ academicSources: [academic], generalWebSources: [], createId: randomUUID });
const approved: GrantResearchGapComparison = {
  sourceGroupId: group!.groupId, existingDesignStatus: "found", existingDesign: [],
  latestDevelopment: { mechanismSummary: "Field-dependent solvation.", quantitativeFindings: [],
    applicationRelation: "Tests the proposed bridge under bias.", evidenceLimitations: [], publicationYear: 2026,
    doi: academic.publication.doi, primarySourceId: academic.sourceId },
  disposition: "residual_gap_found", residualGap: "The application does not distinguish biased states.",
  reasonExistingDesignIsInsufficient: "Only equilibrium measurements are described.",
  recommendation: "Add a biased-state comparison to the existing Raman task.", unableToVerifyReason: null,
  scopeDecision: { finalDecision: "main_suggestion", relevance: "direct", scopeImpact: "small", rejectionReason: null },
  rejectedSuggestion: null,
};
const rejected: GrantResearchGapComparison = { ...approved, sourceGroupId: randomUUID(),
  residualGap: "Lifecycle analysis is absent.", recommendation: "Add lifecycle analysis.",
  scopeDecision: { finalDecision: "reject", relevance: "adjacent", scopeImpact: "major", rejectionReason: "adjacent_topic" },
  rejectedSuggestion: { candidateSummary: "Add lifecycle analysis.", relatedSourceIds: [academic.sourceId], rejectionReason: "adjacent_topic" } };
const trace = { pipelineVersion: "research-grounding-v6", featureFlags: { structuredSources: true,
  existingDesignCheck: true, residualGapScopeFilter: true, evidenceBasedSynthesis: true },
  queryPlannerVersion: "research-query-plan-v1", sourceProviderVersions: ["openalex-v1"],
  evidenceContractVersion: "academic-source-v2", scopeFilterVersion: "grant-research-scope-v1",
  synthesisPromptVersion: "research-answer-selection-v1", model: "test-model", reasoningEffort: "low",
  legacyFallbackUsed: false, startedAt: "2026-09-14T12:00:00.000Z", completedAt: "2026-09-14T12:01:00.000Z" };
const answer = assembleGrantResearchAnswer({ selection: { schemaVersion: 1,
  coreJudgment: "申请书已覆盖平衡态溶剂化，但不能据此证明工作电场下的动态重构。",
  selectedSourceGroupIds: [group!.groupId] }, comparisons: [approved, rejected], sourceGroups: [group!], trace });
assert.match(answer.content, /^1\. 核心判断：/u);
assert.match(answer.content, /2\. 补充建议1：/u);
assert.doesNotMatch(answer.content, /生命周期/u);
assert.equal(answer.sources[0]?.evidenceOrigin, "structured_abstract");
assert.equal(answer.rejectedSuggestions[0]?.rejectionReason, "adjacent_topic");
assert.equal(answer.trace.legacyFallbackUsed, false);

assert.throws(() => assembleGrantResearchAnswer({ selection: { schemaVersion: 1, coreJudgment: "判断",
  selectedSourceGroupIds: [rejected.sourceGroupId] }, comparisons: [approved, rejected], sourceGroups: [group!], trace }),
  /rejected or unavailable/u);
assert.throws(() => assembleGrantResearchAnswer({ selection: { schemaVersion: 1, coreJudgment: "判断",
  selectedSourceGroupIds: [] }, comparisons: [approved], sourceGroups: [group!], trace }), /omitted/u);

console.log("Research answer selection, numbered rendering, source expansion, rejection audit and run trace verified offline.");
