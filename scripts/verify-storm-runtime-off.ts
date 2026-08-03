import assert from "node:assert/strict";
import type { ResearchExplorationCapability } from "../lib/research-exploration/capability.ts";
import { ResearchExplorationInputSchema } from "../lib/research-exploration/contracts.ts";
import {
  resolveResearchExplorationRuntime,
  resolveResearchExplorationRuntimeFromEnvironment,
} from "../lib/research-exploration/runtime-policy.ts";
import { ResearchExplorationShadowCoordinator } from "../lib/research-exploration/shadow/coordinator.ts";
import { ResearchExplorationAdvisoryGateway } from "../lib/research-exploration/advisory/gateway.ts";
import { ResearchExplorationRequiredGateway } from "../lib/research-exploration/required/gateway.ts";

const disabled = resolveResearchExplorationRuntimeFromEnvironment({
  mode: "advisory",
  environment: {},
});
assert.deepEqual(disabled, {
  policyVersion: "research-exploration-runtime-v1",
  mode: "advisory",
  enabled: false,
  reason: "globally_disabled",
});
assert.equal(
  resolveResearchExplorationRuntimeFromEnvironment({
    mode: "required",
    environment: { STORM_RUNTIME_APPROVED: "TRUE" },
  }).enabled,
  true,
);
assert.deepEqual(
  resolveResearchExplorationRuntimeFromEnvironment({
    environment: {
      STORM_RUNTIME_APPROVED: "true",
      STORM_RUNTIME_MODE: "shadow",
    },
  }),
  {
    policyVersion: "research-exploration-runtime-v1",
    mode: "shadow",
    enabled: true,
    reason: "enabled",
  },
);
assert.equal(
  resolveResearchExplorationRuntime({ globallyApproved: true, mode: "off" }).reason,
  "mode_off",
);

const calls = { start: 0, inspect: 0, load: 0, cancel: 0 };
const unreachableCapability: ResearchExplorationCapability = {
  async startOrReuse() {
    calls.start += 1;
    throw new Error("STORM must not start while disabled.");
  },
  async inspect() {
    calls.inspect += 1;
    throw new Error("STORM must not be inspected while disabled.");
  },
  async loadResult() {
    calls.load += 1;
    throw new Error("STORM result must not be read while disabled.");
  },
  async cancel() {
    calls.cancel += 1;
    throw new Error("No disabled execution should require cancellation.");
  },
};
const exploration = ResearchExplorationInputSchema.parse({
  explorationId: "runtime-off-exploration",
  topic: "Physical gel preparation",
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
const shadowDisabled = resolveResearchExplorationRuntime({
  globallyApproved: false,
  mode: "shadow",
});
const shadow = new ResearchExplorationShadowCoordinator(unreachableCapability);
const shadowLaunch = await shadow.launch({
  policy: {
    policyVersion: "research-exploration-shadow-v1",
    enabled: true,
    environment: "development",
    sampleRateBasisPoints: 10_000,
    maximumConcurrentExecutions: 1,
  },
  sampleSubjectId: "job-runtime-off",
  activeExecutionCount: 0,
  exploration,
  runtimeDecision: shadowDisabled,
});
assert.equal(shadowLaunch.selection.reason, "runtime_disabled");
const shadowCollection = await shadow.collect({
  executionId: "67584f85-8c42-4f6b-8960-d16b234c1d85",
  baseline: {
    baselineId: "baseline-off",
    baselineRevision: 1,
    topic: exploration.topic,
    sectionHeadings: [],
    researchQuestions: [],
  },
  runtimeDecision: shadowDisabled,
});
assert.deepEqual(shadowCollection, {
  status: "unavailable",
  failureCode: "runtime_disabled",
});

const advisory = await new ResearchExplorationAdvisoryGateway(
  unreachableCapability,
  disabled,
).resolve("67584f85-8c42-4f6b-8960-d16b234c1d85");
assert.deepEqual(advisory, {
  mode: "advisory",
  outcome: "fallback",
  warningCode: "runtime_disabled",
});

const required = await new ResearchExplorationRequiredGateway(
  unreachableCapability,
  resolveResearchExplorationRuntime({ globallyApproved: false, mode: "required" }),
).resolve("67584f85-8c42-4f6b-8960-d16b234c1d85");
assert.equal(required.outcome, "blocked");
assert.equal(required.failureCode, "runtime_disabled");
assert.deepEqual(calls, { start: 0, inspect: 0, load: 0, cancel: 0 });

console.log("STORM runtime-off isolation tests passed.");
