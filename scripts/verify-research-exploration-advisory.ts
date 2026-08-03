import assert from "node:assert/strict";
import type { ResearchExplorationCapability } from "../lib/research-exploration/capability.ts";
import {
  ResearchExplorationExecutionSchema,
  ResearchExplorationProposalSchema,
} from "../lib/research-exploration/contracts.ts";
import { ResearchExplorationAdvisoryGateway } from "../lib/research-exploration/advisory/gateway.ts";
import { deriveResearchExplorationAdvisoryHints } from "../lib/research-exploration/advisory/hints.ts";

const proposal = ResearchExplorationProposalSchema.parse({
  schemaVersion: 1,
  explorationId: "exploration-advisory-1",
  status: "complete",
  perspectives: [
    { perspectiveKey: "p1", title: "Preparation history", rationale: "r" },
    { perspectiveKey: "p2", title: "Preparation history", rationale: "duplicate" },
  ],
  researchQuestions: [{
    questionKey: "q1",
    perspectiveKey: "p1",
    question: "How does processing history affect relaxation?",
    importance: "high",
    followUpQuestions: [],
  }],
  searchPlans: [],
  sourceCandidates: [{
    sourceCandidateKey: "source-secret-id",
    title: "Candidate source",
    url: "https://example.com/source",
    retrievedBy: "storm",
  }],
  knowledgeNodes: [],
  outlineCandidates: [{
    outlineKey: "o1",
    title: "Physical gels",
    sections: [{
      heading: "Processing history",
      purpose: "Connect preparation variables to network relaxation.",
      questionKeys: ["q1"],
      supportingSourceCandidateKeys: ["source-secret-id"],
    }],
  }],
  unresolvedQuestions: ["Which measurements generalize across gel classes?"],
  warnings: [],
  usage: { modelCalls: 3, searchCalls: 2 },
});
const hints = deriveResearchExplorationAdvisoryHints(proposal);
assert.deepEqual(hints.suggestedPerspectives, ["Preparation history"]);
assert.equal(hints.suggestedSections.length, 1);
assert.equal(JSON.stringify(hints).includes("source-secret-id"), false);
assert.equal(JSON.stringify(hints).includes("https://example.com/source"), false);

const execution = ResearchExplorationExecutionSchema.parse({
  schemaVersion: 1,
  executionId: "4c4b73f7-fc66-44aa-81ca-e6cc2084d2e4",
  explorationId: proposal.explorationId,
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
  inputFingerprint: "b".repeat(64),
  status: "complete",
  remoteExecutionId: "remote-advisory-1",
  resultLocation: "exploration://remote-advisory-1/result-v1",
  inspectionCount: 1,
  maximumInspectionCount: 10,
  expiresAt: "2026-08-04T00:00:00.000Z",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:01:00.000Z",
});
const capability: ResearchExplorationCapability = {
  async startOrReuse() { return execution; },
  async inspect() { return execution; },
  async loadResult() { return proposal; },
  async cancel() { return execution; },
};
const available = await new ResearchExplorationAdvisoryGateway(capability).resolve(
  execution.executionId,
);
assert.equal(available.outcome, "available");
assert.equal(available.hints?.suggestedSections[0]?.heading, "Processing history");

const pendingGateway = new ResearchExplorationAdvisoryGateway({
  ...capability,
  async inspect() { return ResearchExplorationExecutionSchema.parse({ ...execution, status: "running", resultLocation: undefined }); },
});
assert.deepEqual(
  await pendingGateway.resolve(execution.executionId),
  { mode: "advisory", outcome: "fallback", warningCode: "exploration_pending" },
);

const failedGateway = new ResearchExplorationAdvisoryGateway({
  ...capability,
  async inspect() { throw new Error("service unavailable"); },
});
assert.deepEqual(
  await failedGateway.resolve(execution.executionId),
  { mode: "advisory", outcome: "fallback", warningCode: "exploration_result_unavailable" },
);

console.log("Research exploration advisory tests passed.");
