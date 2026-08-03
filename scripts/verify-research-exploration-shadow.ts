import assert from "node:assert/strict";
import type { ResearchExplorationCapability } from "../lib/research-exploration/capability.ts";
import {
  ResearchExplorationExecutionSchema,
  ResearchExplorationInputSchema,
  ResearchExplorationProposalSchema,
} from "../lib/research-exploration/contracts.ts";
import { evaluateResearchExplorationShadow } from "../lib/research-exploration/evaluation/comparator.ts";
import { ResearchExplorationShadowCoordinator } from "../lib/research-exploration/shadow/coordinator.ts";
import { selectResearchExplorationShadow } from "../lib/research-exploration/shadow/policy.ts";
import { resolveResearchExplorationRuntime } from "../lib/research-exploration/runtime-policy.ts";

const policy = {
  policyVersion: "research-exploration-shadow-v1" as const,
  enabled: true,
  environment: "development" as const,
  sampleRateBasisPoints: 10_000,
  maximumConcurrentExecutions: 2,
};
assert.equal(
  selectResearchExplorationShadow({
    policy,
    sampleSubjectId: "job-1",
    activeExecutionCount: 0,
  }).selected,
  true,
);
assert.equal(
  selectResearchExplorationShadow({
    policy: { ...policy, environment: "production" },
    sampleSubjectId: "job-1",
    activeExecutionCount: 0,
  }).reason,
  "production_forbidden",
);
assert.equal(
  selectResearchExplorationShadow({
    policy,
    sampleSubjectId: "job-1",
    activeExecutionCount: 2,
  }).reason,
  "capacity_exhausted",
);

const proposal = ResearchExplorationProposalSchema.parse({
  schemaVersion: 1,
  explorationId: "exploration-1",
  status: "complete",
  perspectives: [{ perspectiveKey: "p1", title: "Mechanisms", rationale: "r" }],
  researchQuestions: [{
    questionKey: "q1",
    perspectiveKey: "p1",
    question: "How do reversible bonds control gels?",
    importance: "high",
    followUpQuestions: [],
  }],
  searchPlans: [],
  sourceCandidates: [
    { sourceCandidateKey: "s1", title: "Source A", url: "https://example.com/a", retrievedBy: "storm" },
    { sourceCandidateKey: "s2", title: "Source A duplicate", url: "https://example.com/a", retrievedBy: "storm" },
  ],
  knowledgeNodes: [],
  outlineCandidates: [{
    outlineKey: "o1",
    title: "Physical gels",
    sections: [
      { heading: "Preparation", purpose: "p", questionKeys: [], supportingSourceCandidateKeys: [] },
      { heading: "Dynamic mechanisms", purpose: "p", questionKeys: ["q1"], supportingSourceCandidateKeys: ["s1"] },
    ],
  }],
  unresolvedQuestions: [],
  warnings: [],
  usage: { modelCalls: 4, searchCalls: 2, estimatedCostUsd: 0.12 },
});
const baseline = {
  baselineId: "baseline-1",
  baselineRevision: 3,
  topic: "Physical gels",
  sectionHeadings: ["Preparation", "Applications"],
  researchQuestions: ["How are physical gels prepared?"],
};
const evaluation = evaluateResearchExplorationShadow({
  baseline,
  proposal,
  explorationRevision: 1,
  now: "2026-08-02T00:00:00.000Z",
});
assert.equal(evaluation.metrics.novelOutlineSectionCount, 1);
assert.equal(evaluation.metrics.baselineHeadingCoverageRatio, 0.5);
assert.equal(evaluation.metrics.duplicateSourceRatio, 0.5);

const execution = ResearchExplorationExecutionSchema.parse({
  schemaVersion: 1,
  executionId: "d22333f0-af65-4b7c-8be6-56e92b30ab12",
  explorationId: "exploration-1",
  explorationRevision: 1,
  executionRevision: 2,
  requirement: "optional",
  adapter: "storm",
  versions: {
    packageVersion: "1.1.0",
    adapterVersion: "1",
    outputContractVersion: "1",
    promptConfigurationVersion: "1",
  },
  inputFingerprint: "a".repeat(64),
  status: "complete",
  remoteExecutionId: "remote-1",
  resultLocation: "exploration://remote-1/result-v1",
  inspectionCount: 1,
  maximumInspectionCount: 10,
  expiresAt: "2026-08-03T00:00:00.000Z",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:01:00.000Z",
});
const explorationInput = ResearchExplorationInputSchema.parse({
  explorationId: "exploration-1",
  topic: "Physical gels",
  purpose: "literature_review",
  language: "en",
  sourcePolicy: { useWeb: true, useUserDocuments: false, userResourceIds: [] },
  limits: {
    maxPerspectives: 4,
    maxQuestionsPerPerspective: 4,
    maxSearchQueries: 20,
    maxSources: 40,
    maximumWallTimeMs: 180_000,
    maximumModelCalls: 30,
    maximumInspectionCount: 10,
  },
  modelProfile: { provider: "test", model: "fake" },
});
let startCalls = 0;
const capability: ResearchExplorationCapability = {
  async startOrReuse() {
    startCalls += 1;
    return execution;
  },
  async inspect() {
    return execution;
  },
  async loadResult() {
    return proposal;
  },
  async cancel() {
    return execution;
  },
};
const coordinator = new ResearchExplorationShadowCoordinator(capability);
const shadowRuntime = resolveResearchExplorationRuntime({
  globallyApproved: true,
  mode: "shadow",
});
const launched = await coordinator.launch({
  policy,
  sampleSubjectId: "job-1",
  activeExecutionCount: 0,
  exploration: explorationInput,
  runtimeDecision: shadowRuntime,
});
assert.equal(launched.executionId, execution.executionId);
assert.equal(startCalls, 1);
const collected = await coordinator.collect({
  executionId: execution.executionId,
  baseline,
  runtimeDecision: shadowRuntime,
});
assert.equal(collected.status, "evaluated");
assert.equal(collected.evaluation?.baselineId, baseline.baselineId);

const failingCapability: ResearchExplorationCapability = {
  ...capability,
  async startOrReuse() {
    throw new Error("provider unavailable");
  },
};
const isolatedFailure = await new ResearchExplorationShadowCoordinator(
  failingCapability,
).launch({
  policy,
  sampleSubjectId: "job-2",
  activeExecutionCount: 0,
  exploration: explorationInput,
  runtimeDecision: shadowRuntime,
});
assert.equal(isolatedFailure.failureCode, "shadow_start_failed");

console.log("Research exploration shadow evaluation tests passed.");
