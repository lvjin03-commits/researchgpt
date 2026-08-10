import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { CanonicalGrantSnapshot } from "../lib/grants/domain/contracts.ts";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS,
  GrantArgumentMapV1Schema,
  GrantArgumentRoleSchema,
} from "../lib/grants/diagnostics/hierarchical-semantic-contracts.ts";
import { buildGrantHierarchicalDiagnosticPreparedInputV1 } from "../lib/grants/diagnostics/hierarchical-semantic-input.ts";
import { buildGrantSemanticDiagnosticV3Input } from "../lib/grants/diagnostics/semantic-v3-input.ts";
import {
  GRANT_HIERARCHICAL_DIAGNOSTIC_CALL_BUDGET_V1,
  GrantHierarchicalDiagnosticExecutionError,
  executeGrantHierarchicalDiagnosticV1,
} from "../lib/grants/infrastructure/model/openai-grant-hierarchical-diagnostic.ts";

const sourceRevisionId = randomUUID();
const sectionId = randomUUID();
const nodeId = randomUUID();
const figureNodeId = randomUUID();
const figureAssetId = randomUUID();
const snapshot: CanonicalGrantSnapshot = {
  schemaVersion: "grant-canonical-v1",
  title: "国家自然科学基金申请书",
  sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", order: 0, nodeIds: [nodeId, figureNodeId] }],
  nodes: [
    { nodeId, sectionId, order: 0, nodeType: "paragraph", content: { text: "申请书提出一个可检验的界面机制问题。" } },
    { nodeId: figureNodeId, sectionId, order: 1, nodeType: "figure", content: { assetId: figureAssetId, altText: "技术路线图", caption: "图1 技术路线" } },
  ],
};
const prepared = buildGrantHierarchicalDiagnosticPreparedInputV1({
  sourceRevisionId,
  prepared: buildGrantSemanticDiagnosticV3Input({
    snapshot,
    inputMode: "full_document",
    inputSectionIds: [sectionId],
    inputNodeIds: [nodeId, figureNodeId],
    fundingCategory: "青年科学基金项目",
    evidenceCards: [],
    priorFindings: [],
  }),
});
const mapPayload = {
  modules: GrantArgumentRoleSchema.options.map((role) => ({
    role,
    presence: "explicit" as const,
    statement: `${role}已有表述。`,
    sourceLocationRefs: ["N1"],
  })),
  relations: [{ fromRole: "knowledge_gap" as const, toRole: "scientific_question" as const, relation: "motivates" as const, sourceLocationRefs: ["N1"] }],
};
const argumentMapCheckpoint = GrantArgumentMapV1Schema.parse({
  schemaVersion: GRANT_HIERARCHICAL_DIAGNOSTIC_TARGET_VERSIONS.argumentMapSchemaVersion,
  sourceRevisionId,
  modules: mapPayload.modules.map((module) => ({
    role: module.role,
    presence: module.presence,
    statement: module.statement,
    sourceLocations: [{ sectionId, nodeId }],
  })),
  relations: mapPayload.relations.map((relation) => ({
    fromRole: relation.fromRole,
    toRole: relation.toRole,
    relation: relation.relation,
    sourceLocations: [{ sectionId, nodeId }],
  })),
});
const rootPayload = {
  rootFindings: [{
    category: "scientific_question_gap",
    affectedArgumentRoles: ["scientific_question"],
    title: "科学问题缺少判定标准",
    diagnosticFact: "申请书提出界面机制问题，但未给出成立与否的判定标准。",
    reason: "评审者无法确认研究如何回答该问题。",
    recommendation: "明确变量关系、观测量和判定标准。",
    possibleConsequence: null,
    assessment: { scope: "section", confidence: 0.9, actionability: "requires_expert_judgment" },
    occurrences: [{ primaryLocationRef: "N1", relatedLocations: [] }],
    evidenceBasis: "document_only",
    usedEvidenceCardIds: [],
  }],
};

type Reply = { content: string; finishReason?: string } | { error: Error };
function queuedClient(replies: Reply[]) {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    chat: { completions: { async create(request: Record<string, unknown>) {
      calls.push(request);
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected provider call beyond test budget.");
      if ("error" in reply) throw reply.error;
      return {
        id: `budget-${calls.length}`,
        object: "chat.completion",
        created: 0,
        model: "gpt-5.5",
        choices: [{ index: 0, finish_reason: reply.finishReason ?? "stop", logprobs: null, message: { role: "assistant", refusal: null, content: reply.content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 1 } },
      };
    } } },
  } as unknown as OpenAI;
  return { client, calls };
}

assert.deepEqual(GRANT_HIERARCHICAL_DIAGNOSTIC_CALL_BUDGET_V1, {
  argumentMapMaxCalls: 1,
  rootDiagnosisMaxCalls: 2,
  totalMaxCalls: 3,
});

const successClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { content: JSON.stringify(rootPayload) },
]);
const success = await executeGrantHierarchicalDiagnosticV1({ client: successClient.client, modelId: "gpt-5.5", prepared });
assert.equal(success.providerCallCount, 2);
assert.deepEqual(success.usage, { inputTokens: 20, outputTokens: 40, reasoningTokens: 2 });
assert.deepEqual(success.stages.map((item) => item.status), ["succeeded", "succeeded", "not_started"]);

let imageAdmissionCalls = 0;
const multimodalClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { content: JSON.stringify(rootPayload) },
]);
const multimodal = await executeGrantHierarchicalDiagnosticV1({
  client: multimodalClient.client,
  modelId: "gpt-5.5",
  prepared,
  imageAdmission: async () => {
    imageAdmissionCalls += 1;
    return {
      images: [{
        imageRef: "I1",
        locationRef: "N2",
        caption: "图1 技术路线",
        mediaType: "image/png" as const,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      }],
      coverage: {
        mode: "multimodal" as const,
        candidateCount: 1,
        authorizedCount: 1,
        suppliedCount: 1,
        omittedCount: 0,
        reasons: [],
        imageScopeFingerprint: "scope-1",
      },
    };
  },
});
assert.equal(imageAdmissionCalls, 1, "authorization and bytes must be materialized immediately before the paid root call");
assert.equal(multimodal.imageCoverage.mode, "multimodal");
const argumentMessages = multimodalClient.calls[0]!.messages as Array<{ content: unknown }>;
assert.ok(argumentMessages.every((message) => typeof message.content === "string"), "ArgumentMap must remain text-only");
const rootMessages = multimodalClient.calls[1]!.messages as Array<{ role: string; content: unknown }>;
const rootUserContent = rootMessages.findLast((message) => message.role === "user")!.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
assert.equal(rootUserContent.filter((part) => part.type === "image_url").length, 1);
assert.match(rootUserContent.find((part) => part.type === "image_url")!.image_url!.url, /^data:image\/png;base64,/);
assert.match(rootUserContent.filter((part) => part.type === "text").map((part) => part.text).join("\n"), /"imageRef":"I1".*"locationRef":"N2"/);

const repairClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { content: JSON.stringify({ rootFindings: [{ category: "scientific_question_gap" }] }) },
  { content: JSON.stringify(rootPayload) },
]);
let repairAdmissionCalls = 0;
const repaired = await executeGrantHierarchicalDiagnosticV1({
  client: repairClient.client,
  modelId: "gpt-5.5",
  prepared,
  imageAdmission: async () => {
    repairAdmissionCalls += 1;
    return {
      images: [],
      coverage: {
        mode: "text_only" as const,
        candidateCount: 1,
        authorizedCount: 0,
        suppliedCount: 0,
        omittedCount: 1,
        reasons: ["not_authorized" as const],
        imageScopeFingerprint: "empty",
      },
    };
  },
});
assert.equal(repaired.providerCallCount, 3);
assert.equal(repairAdmissionCalls, 2, "each paid root attempt must re-read current image authorization");
const repairedMessages = repairClient.calls[2]!.messages as Array<{ role: string; content: string }>;
assert.match(repairedMessages.at(-1)!.content, /Correct only the prior structured-output contract failure/);

const capacityClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { content: JSON.stringify(rootPayload), finishReason: "length" },
  { content: JSON.stringify(rootPayload) },
]);
const capacityRecovered = await executeGrantHierarchicalDiagnosticV1({ client: capacityClient.client, modelId: "gpt-5.5", prepared });
assert.equal(capacityRecovered.providerCallCount, 3);
assert.equal(capacityClient.calls[2]!.max_completion_tokens, 14000);

const invalidReferencePayload = structuredClone(rootPayload);
invalidReferencePayload.rootFindings[0]!.occurrences[0]!.primaryLocationRef = "N999";
const noRetryClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { content: JSON.stringify(invalidReferencePayload) },
]);
await assert.rejects(
  () => executeGrantHierarchicalDiagnosticV1({ client: noRetryClient.client, modelId: "gpt-5.5", prepared }),
  (error: unknown) => error instanceof GrantHierarchicalDiagnosticExecutionError
    && error.failureCode === "root_diagnosis_reference_invalid"
    && error.providerCallCount === 2
    && error.argumentMapCheckpoint?.sourceRevisionId === sourceRevisionId,
);
assert.equal(noRetryClient.calls.length, 2, "reference failures must not consume a retry");

const resumedClient = queuedClient([{ content: JSON.stringify(rootPayload) }]);
const resumed = await executeGrantHierarchicalDiagnosticV1({
  client: resumedClient.client,
  modelId: "gpt-5.5",
  prepared,
  argumentMapCheckpoint,
});
assert.equal(resumed.providerCallCount, 1);
assert.equal(resumed.resumedFromArgumentMap, true);
assert.equal(resumedClient.calls.length, 1, "checkpoint recovery must not regenerate ArgumentMap");

const outOfScopeCheckpoint = structuredClone(argumentMapCheckpoint);
outOfScopeCheckpoint.modules[0]!.sourceLocations = [{ sectionId: randomUUID(), nodeId: randomUUID() }];
const rejectedCheckpointClient = queuedClient([]);
await assert.rejects(
  () => executeGrantHierarchicalDiagnosticV1({
    client: rejectedCheckpointClient.client,
    modelId: "gpt-5.5",
    prepared,
    argumentMapCheckpoint: outOfScopeCheckpoint,
  }),
  (error: unknown) => error instanceof GrantHierarchicalDiagnosticExecutionError
    && error.failureCode === "root_diagnosis_reference_invalid"
    && error.providerCallCount === 0,
);
assert.equal(rejectedCheckpointClient.calls.length, 0, "invalid checkpoints must be rejected before a paid call");

const badMap = { ...mapPayload, modules: mapPayload.modules.slice(1) };
const mapFailureClient = queuedClient([{ content: JSON.stringify(badMap) }]);
await assert.rejects(
  () => executeGrantHierarchicalDiagnosticV1({ client: mapFailureClient.client, modelId: "gpt-5.5", prepared }),
  (error: unknown) => error instanceof GrantHierarchicalDiagnosticExecutionError
    && error.providerCallCount === 1
    && error.stages[0]!.status === "failed"
    && error.stages[1]!.status === "skipped",
);

const providerFailureClient = queuedClient([
  { content: JSON.stringify(mapPayload) },
  { error: new Error("uncertain connection outcome") },
]);
await assert.rejects(
  () => executeGrantHierarchicalDiagnosticV1({ client: providerFailureClient.client, modelId: "gpt-5.5", prepared }),
  (error: unknown) => error instanceof GrantHierarchicalDiagnosticExecutionError && error.providerCallCount === 2,
);
assert.equal(providerFailureClient.calls.length, 2, "unknown provider outcomes must not be retried");

console.log("Grant hierarchical diagnostic unified budget, retry classification and checkpoint recovery contracts passed.");
