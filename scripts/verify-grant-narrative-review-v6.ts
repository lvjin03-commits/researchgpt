import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { assembleGrantNarrativeReviewV1 } from "../lib/grants/diagnostics/semantic-review-v6-narrative-assembler.ts";
import { buildGrantNarrativeReviewModelInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-narrative-input.ts";
import { buildGrantNarrativeReviewMessagesV1 } from "../lib/grants/diagnostics/semantic-review-v6-narrative-prompt.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "../lib/grants/diagnostics/semantic-review-v6-input.ts";
import { textOnlyGrantDiagnosticImageAdmission, type GrantDiagnosticImageAdmission } from "../lib/grants/diagnostics/multimodal-diagnostic-input.ts";
import { executeGrantNarrativeReviewV1, GrantNarrativeReviewExecutionErrorV1 } from "../lib/grants/infrastructure/model/openai-grant-narrative-review-v6.ts";

const revisionId = randomUUID();
const sectionId = randomUUID();
const paragraphId = randomUUID();
const figureNodeId = randomUUID();
const figureAssetId = randomUUID();
const fingerprint = "a".repeat(64);
const sections = [{
  sectionRef: "S1",
  semanticRole: "rationale",
  title: "立项依据",
  parentSectionRef: null,
  order: 0,
  nodes: [
    { locationRef: "N1", nodeType: "paragraph" as const, order: 0, text: "开篇连续介绍一般背景，项目特定问题在末段才出现。" },
    { locationRef: "N2", nodeType: "figure" as const, order: 1, text: "技术路线图" },
  ],
}];
const prepared: GrantSemanticReviewV6PreparedInputV1 = {
  sourceRevisionId: revisionId,
  inputFingerprint: "b".repeat(64),
  locationScopeFingerprint: fingerprint,
  factMapRequest: {
    contractVersion: "grant-semantic-diagnostic-v6", schemaVersion: "grant-fact-map-v1", promptVersion: "grant-semantic-review-v6",
    stage: "fact_mapping", locationScopeFingerprint: fingerprint, documentLanguage: "zh", documentTitle: "离子凝胶申请书",
    fundingCategory: "青年科学基金项目", inputMode: "full_document", sections,
  },
  reviewBaseRequest: {
    contractVersion: "grant-semantic-diagnostic-v6", promptVersion: "grant-semantic-review-v6", stage: "semantic_review_base",
    locationScopeFingerprint: fingerprint, documentLanguage: "zh", documentTitle: "离子凝胶申请书",
    fundingCategory: "青年科学基金项目", inputMode: "full_document", sections, evidenceCards: [], priorFindings: [],
  },
  locationByRef: new Map([["N1", { sectionId, nodeId: paragraphId }], ["N2", { sectionId, nodeId: figureNodeId }]]),
  locationRefByNodeId: new Map([[paragraphId, "N1"], [figureNodeId, "N2"]]),
  sectionIdByNodeId: new Map([[paragraphId, sectionId], [figureNodeId, sectionId]]),
  allowedEvidenceCardIds: new Set(),
  figureLocationRefByAssetId: new Map([[figureAssetId, "N2"]]),
};
const textOnly = textOnlyGrantDiagnosticImageAdmission({ candidateCount: 1, reasons: ["not_authorized"] });
const textNarrative = buildGrantNarrativeReviewModelInputV1({ prepared, imageAdmission: textOnly });
assert.equal(textNarrative.request.stage, "narrative_review");
assert.equal(textNarrative.request.imageCoverage.mode, "text_only");
assert.equal(JSON.stringify(textNarrative.request).includes(paragraphId), false);
assert.equal(textNarrative.imageAssetIdByRef.size, 0);
assert.match(buildGrantNarrativeReviewMessagesV1(textNarrative.request)[0]!.content, /Do not emit visual_communication/);

const admission: GrantDiagnosticImageAdmission = {
  images: [{ imageRef: "I1", locationRef: "N2", caption: "技术路线图", mediaType: "image/png", dataUrl: "data:image/png;base64,AA==" }],
  coverage: { mode: "multimodal", candidateCount: 1, authorizedCount: 1, suppliedCount: 1, omittedCount: 0, reasons: [], imageScopeFingerprint: "c".repeat(64) },
};
const narrative = buildGrantNarrativeReviewModelInputV1({ prepared, imageAdmission: admission });
assert.equal(narrative.imageAssetIdByRef.get("I1"), figureAssetId);
assert.match(buildGrantNarrativeReviewMessagesV1(narrative.request)[0]!.content, /visible defects in supplied images/);

const flowFinding: {
  findingRef: string;
  category: "narrative_flow" | "visual_communication";
  title: string;
  observedPresentation: string;
  readerFriction: string;
  suggestedOrganization: string;
  affectedScope: "opening" | "figure";
  assessment: { scope: "paragraph"; confidence: number; actionability: "directly_actionable" };
  primaryLocationRef: string;
  relatedLocations: Array<{ locationRef: string; role: "comparison_location" }>;
  usedImageRefs: string[];
} = {
  findingRef: "F1", category: "narrative_flow", title: "项目问题出现较晚",
  observedPresentation: "开篇先连续介绍一般背景，项目特定问题在末段才出现。",
  readerFriction: "读者需要较长时间才能识别项目聚焦的问题。",
  suggestedOrganization: "在开篇前段提前概括项目特定矛盾，再展开必要背景。",
  affectedScope: "opening", assessment: { scope: "paragraph", confidence: 0.88, actionability: "directly_actionable" },
  primaryLocationRef: "N1", relatedLocations: [], usedImageRefs: [] as string[],
};
const flowAssembled = assembleGrantNarrativeReviewV1({ prepared, narrative: textNarrative, providerResult: { findings: [flowFinding] } });
assert.equal(flowAssembled.success, true);

const forbiddenVisual = { ...flowFinding, findingRef: "F2", category: "visual_communication", affectedScope: "figure", primaryLocationRef: "N2", usedImageRefs: ["I1"] };
assert.equal(assembleGrantNarrativeReviewV1({ prepared, narrative: textNarrative, providerResult: { findings: [forbiddenVisual] } }).success, false);
const visualAssembled = assembleGrantNarrativeReviewV1({ prepared, narrative, providerResult: { findings: [forbiddenVisual] } });
assert.equal(visualAssembled.success, true);
if (visualAssembled.success) assert.deepEqual(visualAssembled.narrativeFindings[0]?.usedFigureAssetIds, [figureAssetId]);

const badRelated = structuredClone(flowFinding);
badRelated.relatedLocations = [{ locationRef: "N99", role: "comparison_location" }];
const normalized = assembleGrantNarrativeReviewV1({ prepared, narrative: textNarrative, providerResult: { findings: [badRelated] } });
assert.equal(normalized.success, true);
if (normalized.success) assert.equal(normalized.actions[0]?.code, "drop_invalid_related_location");

const calls: Array<Record<string, unknown>> = [];
function fakeClient(result: unknown, finishReason = "stop"): OpenAI {
  return { chat: { completions: { create: async (payload: Record<string, unknown>) => {
    calls.push(payload);
    return { id: "chatcmpl-narrative-v1", choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(result), refusal: null } }], usage: { prompt_tokens: 1000, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: 80 } } };
  } } } } as unknown as OpenAI;
}
const executed = await executeGrantNarrativeReviewV1({ client: fakeClient({ findings: [flowFinding] }), modelId: "gpt-5.5", prepared, imageAdmission: textOnly, maxCompletionTokens: 8000 });
assert.equal(executed.narrativeFindings.length, 1);
assert.equal(executed.execution.operation, "diagnostic.narrative_review");
assert.equal(calls.length, 1);
assert.equal(calls[0]!.max_completion_tokens, 8000);
assert.equal(calls[0]!.reasoning_effort, "medium");
await assert.rejects(
  () => executeGrantNarrativeReviewV1({ client: fakeClient({ findings: [] }, "length"), modelId: "gpt-5.5", prepared, imageAdmission: textOnly, maxCompletionTokens: 8000 }),
  (error: unknown) => error instanceof GrantNarrativeReviewExecutionErrorV1 && error.code === "narrative_review_output_truncated",
);

console.log("Grant Semantic Review V6 narrative input, prompt, image scope, assembly and executor checks passed.");
