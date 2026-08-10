import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GrantDiagnosticService } from "../lib/grants/application/diagnostic-service.ts";
import { GrantModelDataGateway } from "../lib/grants/application/grant-model-data-gateway.ts";
import { GrantRevisionService } from "../lib/grants/application/revision-service.ts";
import { GrantSemanticDiagnosticChecker } from "../lib/grants/application/semantic-diagnostic-checker.ts";
import { GrantStructuralCompletenessChecker } from "../lib/grants/diagnostics/structural-completeness-checker.ts";
import { InMemoryGrantDiagnosticRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-diagnostic-repository.ts";
import { InMemoryGrantRevisionRepository } from "../lib/grants/infrastructure/memory/in-memory-grant-revision-repository.ts";
import type { GrantDiagnosticModel } from "../lib/grants/ports/grant-diagnostic-model.ts";
import {
  GRANT_DIAGNOSTIC_POLICY_VERSION,
  GRANT_DIAGNOSTIC_PROMPT_VERSION,
  GRANT_DIAGNOSTIC_SCHEMA_VERSION,
  GrantDiagnosticExecutionError,
} from "../lib/grants/ports/grant-diagnostic-model.ts";
import type { GrantPatchModel } from "../lib/grants/ports/grant-patch-model.ts";
import OpenAI from "openai";
import { grantDiagnosticResponseFormat, OpenAIGrantAiModel } from "../lib/grants/infrastructure/model/openai-grant-ai-model.ts";

const ownerId = randomUUID();
const revisions = new GrantRevisionService({ repository: new InMemoryGrantRevisionRepository() });
const aggregate = await revisions.createDocument({
  ownerId,
  actorId: ownerId,
  draft: {
    title: "国自然申请书",
    sections: [{
      localKey: "basis",
      semanticRole: "rationale",
      title: "立项依据",
      order: 0,
      nodes: [{ localKey: "basis-p1", nodeType: "paragraph", content: { text: "研究问题尚未明确说明关键变量之间的因果关系。" } }],
    }],
  },
  template: { templateKey: "nsfc-general", templateVersion: "1", rules: {} },
});
const sectionId = aggregate.currentRevision.snapshot.sections[0]!.sectionId;
const nodeId = aggregate.currentRevision.snapshot.nodes[0]!.nodeId;

const requests: Parameters<GrantDiagnosticModel["diagnose"]>[0][] = [];
const model: GrantPatchModel & GrantDiagnosticModel = {
  async generate() {
    return { replacementText: "test", provider: "openai", modelId: "gpt-5.5", usedEvidenceCardIds: [] };
  },
  async diagnose(request) {
    requests.push(request);
    return {
      findings: [{
        category: "scientific_question_gap",
        message: "核心科学问题尚未形成可检验的因果命题。",
        recommendation: "明确关键变量、作用方向和可证伪的预期关系。",
        assessment: { scope: "section", confidence: 0.88, actionability: "requires_expert_judgment" },
        sectionId,
        nodeId,
      }],
      provider: "openai",
      modelId: "gpt-5.5",
      usage: { inputTokens: 120, outputTokens: 80, reasoningTokens: 24 },
      execution: {
        operation: "diagnostic.semantic",
        policyVersion: GRANT_DIAGNOSTIC_POLICY_VERSION,
        schemaVersion: GRANT_DIAGNOSTIC_SCHEMA_VERSION,
        promptVersion: GRANT_DIAGNOSTIC_PROMPT_VERSION,
        provider: "openai",
        modelId: "gpt-5.5",
        finishReason: "stop",
        attemptCount: 1,
        attemptPurpose: "initial",
        inputTokens: 120,
        outputTokens: 80,
        reasoningTokens: 24,
      },
    };
  },
};
const repository = new InMemoryGrantDiagnosticRepository();
const service = new GrantDiagnosticService({
  revisionService: revisions,
  repository,
  checkers: [
    new GrantStructuralCompletenessChecker(),
    new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(model), "gpt-5.5"),
  ],
  incrementalEnabled: true,
});
const execution = await service.run(aggregate.document.documentId, ownerId);
assert.equal(execution.executionStatus, "complete");
assert.equal(requests.length, 1);
assert.equal(requests[0]!.sections[0]!.nodes[0]!.nodeId, nodeId);
assert.equal(execution.findings.some((finding) => finding.code === "scientific_question_gap"), true);
const semanticRun = execution.runs.find((run) => run.checkerId === "grant-semantic-argument-diagnostic");
assert.equal(semanticRun?.parsedOutput.metadata && (semanticRun.parsedOutput.metadata as Record<string, unknown>).modelId, "gpt-5.5");
const completeProjection = await service.list(aggregate.document.documentId);
assert.equal(completeProjection.coverage.semantic, "complete");
assert.equal(completeProjection.executionStatus, "complete");

const failingModel: GrantPatchModel & GrantDiagnosticModel = {
  ...model,
  async diagnose() {
    throw new GrantDiagnosticExecutionError("output_truncated", "output truncated", {
      operation: "diagnostic.semantic",
      policyVersion: GRANT_DIAGNOSTIC_POLICY_VERSION,
      schemaVersion: GRANT_DIAGNOSTIC_SCHEMA_VERSION,
      promptVersion: GRANT_DIAGNOSTIC_PROMPT_VERSION,
      provider: "openai",
      modelId: "gpt-5.5",
      finishReason: "length",
      attemptCount: 2,
      attemptPurpose: "capacity_retry",
      inputTokens: 100,
      outputTokens: 7000,
      reasoningTokens: 1000,
    });
  },
};
const failureRepository = new InMemoryGrantDiagnosticRepository();
const failureService = new GrantDiagnosticService({
  revisionService: revisions,
  repository: failureRepository,
  checkers: [
    new GrantStructuralCompletenessChecker(),
    new GrantSemanticDiagnosticChecker(new GrantModelDataGateway(failingModel), "gpt-5.5"),
  ],
  incrementalEnabled: true,
});
const partial = await failureService.run(aggregate.document.documentId, ownerId);
assert.equal(partial.executionStatus, "partial");
assert.equal(partial.runs.some((run) => run.checkerId === "grant.structural_completeness" && run.status === "succeeded"), true);
assert.equal(partial.runs.some((run) => run.checkerId === "grant-semantic-argument-diagnostic" && run.status === "failed"), true);
const failedProjection = await failureService.list(aggregate.document.documentId);
const failedCoverage = failedProjection.coverage;
assert.equal(failedProjection.executionStatus, "partial");
assert.equal(failedCoverage.semantic, "failed");
assert.equal(failedCoverage.semanticFailure?.category, "output_truncated");
assert.equal(failedCoverage.semanticFailure?.finishReason, "length");
assert.equal(failedCoverage.semanticFailure?.attemptCount, 2);

const invalidModel: GrantPatchModel & GrantDiagnosticModel = {
  ...model,
  async diagnose(request) {
    const result = await model.diagnose(request);
    return { ...result, findings: result.findings.map((finding) => ({ ...finding, nodeId: randomUUID() })) };
  },
};
await assert.rejects(new GrantModelDataGateway(invalidModel).diagnose({
  documentId: aggregate.document.documentId,
  taskId: randomUUID(),
  snapshot: aggregate.currentRevision.snapshot,
  inputMode: "full_document",
  inputSectionIds: [sectionId],
  inputNodeIds: [nodeId],
}), /未授权或不存在/);

const compositionSource = await readFile(new URL("../lib/grants/server/composition.ts", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../components/grants/grant-diagnostics-panel.tsx", import.meta.url), "utf8");
assert.doesNotMatch(compositionSource, /DEEPSEEK|GRANT_PATCH_PROVIDER|GRANT_PATCH_MODEL/);
assert.match(compositionSource, /GrantSemanticDiagnosticChecker/);
assert.match(panelSource, /AI诊断/);
assert.match(panelSource, /GPT 语义诊断未完成/);
assert.match(panelSource, /GPT 输出达到长度上限/);
assert.match(panelSource, /诊断结构不符合当前合同/);

const responseFormat = grantDiagnosticResponseFormat();
assert.equal(responseFormat.type, "json_schema");
assert.equal(responseFormat.json_schema.strict, true);
const jsonSchema = responseFormat.json_schema.schema as Record<string, unknown>;
assert.equal(jsonSchema.type, "object");
assert.deepEqual(jsonSchema.required, ["findings"]);
assert.equal(jsonSchema.additionalProperties, false);

function assertStrictObjects(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false);
    const properties = record.properties && typeof record.properties === "object"
      ? Object.keys(record.properties as Record<string, unknown>)
      : [];
    assert.deepEqual(record.required, properties);
  }
  Object.values(record).forEach(assertStrictObjects);
}
assertStrictObjects(jsonSchema);

const validContent = JSON.stringify({
  findings: [{
    category: "scientific_question_gap",
    message: "核心科学问题尚未形成可检验命题。",
    recommendation: "明确变量、作用方向和可证伪关系。",
    assessment: { scope: "section", confidence: 0.9, actionability: "requires_expert_judgment" },
    sectionId,
    nodeId,
  }],
});
let providerCalls = 0;
const retryClient = {
  chat: {
    completions: {
      async create() {
        providerCalls += 1;
        const finishReason = providerCalls === 1 ? "length" : "stop";
        return {
          id: `provider-${providerCalls}`,
          object: "chat.completion",
          created: 0,
          model: "gpt-5.5",
          choices: [{ index: 0, finish_reason: finishReason, logprobs: null, message: { role: "assistant", refusal: null, content: validContent } }],
          usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, completion_tokens_details: { reasoning_tokens: 20 } },
        };
      },
    },
  },
} as unknown as OpenAI;
const retryResult = await new OpenAIGrantAiModel("gpt-5.5", "test-key", retryClient).diagnose({
  documentLanguage: "zh",
  documentTitle: "国自然申请书",
  inputMode: "full_document",
  sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", nodes: [{ nodeId, sectionId, nodeType: "paragraph", text: "正文" }] }],
  evidence: [],
});
assert.equal(providerCalls, 2);
assert.equal(retryResult.execution.attemptCount, 2);
assert.equal(retryResult.execution.attemptPurpose, "capacity_retry");
assert.equal(retryResult.execution.recoveredFrom, "output_truncated");
assert.equal(retryResult.usage.outputTokens, 400);

let filterCalls = 0;
const filterClient = {
  chat: { completions: { async create() {
    filterCalls += 1;
    return {
      id: "filtered",
      object: "chat.completion",
      created: 0,
      model: "gpt-5.5",
      choices: [{ index: 0, finish_reason: "content_filter", logprobs: null, message: { role: "assistant", refusal: null, content: null } }],
    };
  } } },
} as unknown as OpenAI;
await assert.rejects(
  new OpenAIGrantAiModel("gpt-5.5", "test-key", filterClient).diagnose({
    documentLanguage: "zh",
    documentTitle: "国自然申请书",
    inputMode: "full_document",
    sections: [{ sectionId, semanticRole: "rationale", title: "立项依据", nodes: [{ nodeId, sectionId, nodeType: "paragraph", text: "正文" }] }],
    evidence: [],
  }),
  (error: unknown) => error instanceof GrantDiagnosticExecutionError && error.category === "content_filtered",
);
assert.equal(filterCalls, 1);

console.log("Grant GPT semantic diagnostic contracts passed.");
