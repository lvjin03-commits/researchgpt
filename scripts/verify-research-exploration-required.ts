import assert from "node:assert/strict";
import type { ResearchExplorationCapability } from "../lib/research-exploration/capability.ts";
import {
  ResearchExplorationExecutionSchema,
  ResearchExplorationProposalSchema,
  type ResearchExplorationExecution,
} from "../lib/research-exploration/contracts.ts";
import {
  ResearchExplorationRequiredGateway,
  requireResearchExplorationForPlanning,
} from "../lib/research-exploration/required/gateway.ts";
import {
  ResearchExplorationRequiredPlanningError,
} from "../lib/research-exploration/required/contracts.ts";

const execution = ResearchExplorationExecutionSchema.parse({
  schemaVersion: 1,
  executionId: "67584f85-8c42-4f6b-8960-d16b234c1d85",
  explorationId: "required-exploration",
  explorationRevision: 1,
  executionRevision: 2,
  requirement: "required",
  adapter: "storm",
  versions: {
    packageVersion: "1.1.0",
    adapterVersion: "1",
    outputContractVersion: "1",
    promptConfigurationVersion: "1",
  },
  inputFingerprint: "c".repeat(64),
  status: "complete",
  remoteExecutionId: "remote-required",
  resultLocation: "exploration://remote-required/result-v1",
  inspectionCount: 1,
  maximumInspectionCount: 10,
  expiresAt: "2026-08-04T00:00:00.000Z",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:01:00.000Z",
});
const proposal = ResearchExplorationProposalSchema.parse({
  schemaVersion: 1,
  explorationId: execution.explorationId,
  status: "partial",
  perspectives: [{ perspectiveKey: "p1", title: "Mechanism", rationale: "r" }],
  researchQuestions: [{
    questionKey: "q1",
    perspectiveKey: "p1",
    question: "Which mechanisms define the field?",
    importance: "high",
    followUpQuestions: [],
  }],
  searchPlans: [],
  sourceCandidates: [{
    sourceCandidateKey: "private-source-key",
    title: "Candidate only",
    url: "https://example.com/private",
    retrievedBy: "storm",
  }],
  knowledgeNodes: [],
  outlineCandidates: [{
    outlineKey: "o1",
    title: "Landscape",
    sections: [{
      heading: "Mechanisms",
      purpose: "Organize the main mechanisms.",
      questionKeys: ["q1"],
      supportingSourceCandidateKeys: ["private-source-key"],
    }],
  }],
  unresolvedQuestions: [],
  warnings: ["Partial exploration retained."],
  usage: { modelCalls: 2, searchCalls: 1 },
});
const capability: ResearchExplorationCapability = {
  async startOrReuse() { return execution; },
  async inspect() { return execution; },
  async loadResult() { return proposal; },
  async cancel() { return execution; },
};

const available = await new ResearchExplorationRequiredGateway(capability).resolve(
  execution.executionId,
);
assert.equal(available.outcome, "available");
const hints = requireResearchExplorationForPlanning(available);
assert.equal(hints.suggestedSections[0]?.heading, "Mechanisms");
assert.equal(JSON.stringify(hints).includes("private-source-key"), false);
assert.equal(JSON.stringify(hints).includes("example.com"), false);

function withStatus(status: ResearchExplorationExecution["status"]) {
  return ResearchExplorationExecutionSchema.parse({
    ...execution,
    status,
    resultLocation: ["partial", "complete"].includes(status)
      ? execution.resultLocation
      : undefined,
    failure: ["failed", "unknown_outcome"].includes(status)
      ? {
          code: "provider_failure",
          category: status === "unknown_outcome" ? "unknown_outcome" : "provider",
          retryability: "none",
          technicalMessage: "Provider did not complete research.",
          userMessageCode: "research.failed",
        }
      : undefined,
  });
}

const waiting = await new ResearchExplorationRequiredGateway({
  ...capability,
  async inspect() { return withStatus("running"); },
}).resolve(execution.executionId);
assert.equal(waiting.outcome, "waiting");
assert.throws(
  () => requireResearchExplorationForPlanning(waiting),
  ResearchExplorationRequiredPlanningError,
);

for (const [status, failureCode] of [
  ["failed", "exploration_failed"],
  ["unknown_outcome", "exploration_unknown_outcome"],
  ["expired", "exploration_expired"],
  ["cancelled", "exploration_cancelled"],
] as const) {
  const blocked = await new ResearchExplorationRequiredGateway({
    ...capability,
    async inspect() { return withStatus(status); },
  }).resolve(execution.executionId);
  assert.equal(blocked.outcome, "blocked");
  assert.equal(blocked.failureCode, failureCode);
}

const unavailable = await new ResearchExplorationRequiredGateway({
  ...capability,
  async loadResult() { throw new Error("missing durable result"); },
}).resolve(execution.executionId);
assert.equal(unavailable.outcome, "blocked");
assert.equal(unavailable.failureCode, "exploration_result_unavailable");

console.log("Research exploration required-mode tests passed.");
