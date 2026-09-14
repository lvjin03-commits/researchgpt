import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { executeGrantResearchEvidencePipeline } from "../lib/grants/application/grant-research-evidence-pipeline.ts";
import { createGrantAcademicSourceRecord } from "../lib/grants/web-sources/academic-source-record.ts";
import { composeGrantResearchSources } from "../lib/grants/web-sources/research-source-acquisition.ts";

const sourceId = randomUUID();
const source = createGrantAcademicSourceRecord({ sourceId, retrievedAt: "2026-09-14T12:00:00.000Z", result: {
  providerId: "openalex", providerRecordId: "W1234567890", url: "https://openalex.org/W1234567890",
  title: "Dynamic zinc solvation", abstract: "Biased spectroscopy resolves dynamic zinc solvation at 2 V.",
  publicationYear: 2026, publicationDate: "2026-04-01", doi: "https://doi.org/10.1000/zinc",
  venue: "Example Journal", authors: ["A. Researcher"], retracted: false,
} });
const [group] = composeGrantResearchSources({ academicSources: [source], generalWebSources: [], createId: randomUUID });
const sectionId = randomUUID();
const nodeId = randomUUID();
const trace = { pipelineVersion: "research-grounding-v6", featureFlags: { structuredSources: true,
  existingDesignCheck: true, residualGapScopeFilter: true, evidenceBasedSynthesis: true },
  queryPlannerVersion: "research-query-plan-v1", sourceProviderVersions: ["openalex-v1"],
  evidenceContractVersion: "academic-source-v2", scopeFilterVersion: "grant-research-scope-v1",
  synthesisPromptVersion: "research-answer-selection-v1", model: "test-model", reasoningEffort: "low",
  legacyFallbackUsed: false, startedAt: "2026-09-14T12:00:00.000Z", completedAt: "2026-09-14T12:01:00.000Z" };

const result = executeGrantResearchEvidencePipeline({ sourceGroups: [group!], locationByRef: new Map([["N1", { sectionId, nodeId }]]),
  sourceAssessmentProposal: { schemaVersion: 2, assessments: [{ sourceGroupId: group!.groupId,
    disposition: "recommended", reason: "Direct mechanism match", mechanismSummary: "Bias changes zinc solvation.",
    quantitativeFindings: [{ statement: "The measurement was performed at 2 V.", sourceIds: [sourceId] }],
    applicationRelation: "Tests the proposed bridge under operating bias.", evidenceLimitations: [] }] },
  gapComparisonProposal: { schemaVersion: 1, comparisons: [{ sourceGroupId: group!.groupId,
    existingDesignStatus: "found", existingDesign: [{ locationRef: "N1", summary: "Equilibrium Raman is planned.",
      evidenceTier: "structural_evidence", coverageLevel: "planned", verificationStatus: "document_statement_only",
      supportBoundary: { directlySupports: ["Raman is planned."], indirectlySupports: [],
        doesNotSupport: ["Biased-state reconstruction is demonstrated."] } }],
    disposition: "residual_gap_found", residualGap: "The planned Raman does not compare biased states.",
    reasonExistingDesignIsInsufficient: "Equilibrium spectra cannot establish field-dependent reconstruction.",
    recommendation: "Add a biased-state comparison to the existing Raman task.", unableToVerifyReason: null,
    scopeSignals: { coreQuestionMatch: 2, researchObjectMatch: 2, mechanismMatch: 2, plannedMethodMatch: 1,
      introducesNewObject: false, introducesNewMethodChain: false, introducesNewEvaluationSystem: false, workloadImpact: 1 } }] },
  answerSelection: { schemaVersion: 1, coreJudgment: "申请书已覆盖平衡态结构，但尚不能证明工作状态下的动态变化。",
    selectedSourceGroupIds: [group!.groupId] }, trace });

assert.equal(result.assessments.length, 1);
assert.equal(result.comparisons[0]?.scopeDecision.finalDecision, "main_suggestion");
assert.match(result.answer.content, /2\. 补充建议1/u);
assert.equal(result.answer.sources[0]?.doi, "https://doi.org/10.1000/zinc");

const rejectedProposal = structuredClone({ schemaVersion: 1, comparisons: [{
  sourceGroupId: group!.groupId, existingDesignStatus: "not_found", existingDesign: [],
  disposition: "residual_gap_found", residualGap: "Lifecycle analysis is absent.",
  reasonExistingDesignIsInsufficient: "No lifecycle work is proposed.", recommendation: "Add lifecycle analysis.",
  unableToVerifyReason: null, scopeSignals: { coreQuestionMatch: 0, researchObjectMatch: 1, mechanismMatch: 0,
    plannedMethodMatch: 0, introducesNewObject: false, introducesNewMethodChain: true,
    introducesNewEvaluationSystem: true, workloadImpact: 3 } }] });
assert.throws(() => executeGrantResearchEvidencePipeline({ sourceGroups: [group!], locationByRef: new Map(),
  sourceAssessmentProposal: { schemaVersion: 2, assessments: [{ sourceGroupId: group!.groupId,
    disposition: "recommended", reason: "Adjacent", mechanismSummary: "Lifecycle context.", quantitativeFindings: [],
    applicationRelation: "Adjacent only.", evidenceLimitations: [] }] }, gapComparisonProposal: rejectedProposal,
  answerSelection: { schemaVersion: 1, coreJudgment: "判断", selectedSourceGroupIds: [group!.groupId] }, trace }),
  /rejected or unavailable/u);

console.log("The single Grant research evidence pipeline enforces assessment, gap, scope and output gates offline.");
