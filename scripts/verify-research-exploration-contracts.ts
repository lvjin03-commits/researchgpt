import assert from "node:assert/strict";
import {
  ResearchExplorationInputSchema,
  ResearchExplorationProposalSchema,
  ResearchExplorationExecutionSchema,
} from "../lib/research-exploration/contracts.ts";
import { createResearchExplorationFingerprint } from "../lib/research-exploration/fingerprint.ts";
import {
  createQueuedResearchExplorationExecution,
  isTerminalResearchExplorationStatus,
  ResearchExplorationTransitionError,
  transitionResearchExplorationExecution,
} from "../lib/research-exploration/execution.ts";
import {
  mapStormResultToProposal,
  StormResearchExplorationAdapter,
  type StormExplorationTransport,
} from "../lib/research-exploration/adapters/storm-adapter.ts";

const versions = {
  packageVersion: "1.1.0",
  adapterVersion: "storm-adapter-v1",
  outputContractVersion: "storm-exploration-result-v1",
  promptConfigurationVersion: "storm-prompt-v1",
} as const;

const request = ResearchExplorationInputSchema.parse({
  explorationId: "explore-physical-gels",
  topic: "Physical gel preparation and structural regulation",
  purpose: "literature_review",
  language: "en",
  scope: {
    timeRange: { fromYear: 2015, toYear: 2026 },
    disciplines: ["materials science", "polymer science"],
    excludedTopics: ["chemical gels"],
  },
  sourcePolicy: {
    useWeb: true,
    useUserDocuments: false,
    userResourceIds: [],
  },
  limits: {
    maxPerspectives: 4,
    maxQuestionsPerPerspective: 4,
    maxSearchQueries: 20,
    maxSources: 40,
    maximumWallTimeMs: 180_000,
    maximumModelCalls: 30,
    maximumInspectionCount: 8,
  },
  modelProfile: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    reasoningEffort: "low",
  },
});

assert.equal(
  ResearchExplorationInputSchema.safeParse({
    ...request,
    sourcePolicy: { useWeb: false, useUserDocuments: false, userResourceIds: [] },
  }).success,
  false,
);

const fingerprint = createResearchExplorationFingerprint({ request, versions });
const reorderedFingerprint = createResearchExplorationFingerprint({
  request: {
    ...request,
    scope: {
      ...request.scope,
      disciplines: [...request.scope.disciplines].reverse(),
    },
  },
  versions,
});
assert.equal(fingerprint, reorderedFingerprint);
assert.notEqual(
  fingerprint,
  createResearchExplorationFingerprint({
    request: { ...request, limits: { ...request.limits, maxSources: 41 } },
    versions,
  }),
);

const queued = createQueuedResearchExplorationExecution({
  explorationId: request.explorationId,
  explorationRevision: 1,
  inputFingerprint: fingerprint,
  requirement: "optional",
  versions,
  maximumInspectionCount: request.limits.maximumInspectionCount,
  expiresAt: "2026-08-03T01:00:00.000Z",
  now: "2026-08-03T00:00:00.000Z",
});
assert.equal(queued.status, "queued");
const running = transitionResearchExplorationExecution({
  execution: queued,
  status: "running",
  remoteExecutionId: "storm-remote-1",
  nextCheckAt: "2026-08-03T00:00:15.000Z",
  now: "2026-08-03T00:00:01.000Z",
});
const complete = transitionResearchExplorationExecution({
  execution: running,
  status: "complete",
  resultLocation: "exploration://storm-remote-1/result-v1",
  incrementInspectionCount: true,
  now: "2026-08-03T00:00:16.000Z",
});
assert.equal(complete.executionRevision, 2);
assert.equal(complete.inspectionCount, 1);
assert.equal(isTerminalResearchExplorationStatus(complete.status), true);
assert.throws(
  () => transitionResearchExplorationExecution({ execution: complete, status: "running" }),
  ResearchExplorationTransitionError,
);
assert.equal(
  ResearchExplorationExecutionSchema.safeParse({
    ...running,
    status: "unknown_outcome",
    failure: undefined,
  }).success,
  false,
);

const rawStormResult = {
  schemaVersion: "storm-exploration-result-v1",
  explorationId: request.explorationId,
  status: "complete",
  unexpectedFutureField: "ignored by the adapter",
  perspectives: [
    { key: "perspective-1", title: "Preparation history", rationale: "Processing history shapes network topology." },
    { key: "perspective-1", title: "Duplicate", rationale: "Must be ignored." },
  ],
  questions: [
    {
      key: "question-1",
      perspectiveKey: "perspective-1",
      question: "How does preparation history control relaxation?",
      importance: "high",
      followUps: [],
    },
    {
      key: "question-orphan",
      perspectiveKey: "missing-perspective",
      question: "This question must be omitted.",
      importance: "low",
      followUps: [],
    },
  ],
  searches: [
    {
      key: "query-1",
      questionKey: "question-1",
      query: "physical gel preparation history relaxation",
      sourceType: "web",
    },
  ],
  sources: [
    {
      key: "source-1",
      title: "Candidate source",
      url: "not a URL",
      authors: ["Example Author"],
      year: 2024,
      retrievedBy: "storm-web",
    },
  ],
  knowledge: [
    {
      key: "node-1",
      title: "Processing history",
      summary: "A candidate synthesis only.",
      sourceKeys: ["source-1", "missing-source"],
    },
  ],
  outlines: [
    {
      key: "outline-1",
      title: "Candidate outline",
      sections: [
        {
          heading: "Preparation pathways",
          purpose: "Compare processing routes.",
          questionKeys: ["question-1", "missing-question"],
          sourceKeys: ["source-1", "missing-source"],
        },
      ],
    },
  ],
  unresolvedQuestions: [],
  warnings: [],
  usage: { modelCalls: 3, searchCalls: 1 },
};

const proposal = mapStormResultToProposal(rawStormResult);
assert.equal(ResearchExplorationProposalSchema.parse(proposal).status, "complete");
assert.equal(proposal.perspectives.length, 1);
assert.equal(proposal.researchQuestions.length, 1);
assert.equal(proposal.sourceCandidates[0]?.url, undefined);
assert.deepEqual(proposal.knowledgeNodes[0]?.supportingSourceCandidateKeys, ["source-1"]);
assert.deepEqual(proposal.outlineCandidates[0]?.sections[0]?.questionKeys, ["question-1"]);
assert.equal(proposal.warnings.length >= 3, true);
assert.equal("verificationStatus" in proposal.sourceCandidates[0], false);
assert.equal(
  ResearchExplorationProposalSchema.safeParse({
    ...proposal,
    researchQuestions: [
      { ...proposal.researchQuestions[0], perspectiveKey: "missing-perspective" },
    ],
  }).success,
  false,
);
assert.equal(
  ResearchExplorationProposalSchema.safeParse({
    ...proposal,
    status: "complete",
    perspectives: [],
    researchQuestions: [],
    outlineCandidates: [],
  }).success,
  false,
);

class FakeStormTransport implements StormExplorationTransport {
  startPayload: unknown;
  async start(payload: unknown) {
    this.startPayload = payload;
    return { remoteExecutionId: "storm-remote-1", status: "queued" };
  }
  async inspect() {
    return { status: "complete", resultLocation: "exploration://result-v1" };
  }
  async loadResult() {
    return rawStormResult;
  }
  async cancel() {}
}

const transport = new FakeStormTransport();
const adapter = new StormResearchExplorationAdapter(transport);
assert.equal((await adapter.start(request)).remoteExecutionId, "storm-remote-1");
assert.equal((transport.startPayload as { schemaVersion: string }).schemaVersion, "storm-exploration-request-v1");
assert.equal((await adapter.inspect("storm-remote-1")).status, "complete");
assert.equal((await adapter.loadResult("exploration://result-v1")).explorationId, request.explorationId);

console.log("Research exploration contract tests passed.");
