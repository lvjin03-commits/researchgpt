import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assembleGrantResearchGapComparisons } from "../lib/grants/web-sources/research-gap-comparison.ts";
import type { GrantResearchSourceAssessmentView } from "../lib/grants/web-sources/research-source-assessment.ts";

const sectionId = randomUUID();
const nodeId = randomUUID();
const sourceGroupId = randomUUID();
const assessment: GrantResearchSourceAssessmentView = {
  sourceGroupId, disposition: "recommended", reason: "Relevant",
  mechanismSummary: "The field reorganizes the secondary solvation environment.",
  quantitativeFindings: [], applicationRelation: "Tests the proposed bridge under polarization.",
  evidenceLimitations: ["No full-cell loading in the abstract."], publicationYear: 2026,
  doi: "https://doi.org/10.1000/zinc", primarySourceId: randomUUID(),
};
const locations = new Map([["N1", { sectionId, nodeId }]]);
const scopeSignals = { coreQuestionMatch: 1, researchObjectMatch: 1, mechanismMatch: 1, plannedMethodMatch: 0,
  introducesNewObject: false, introducesNewMethodChain: false, introducesNewEvaluationSystem: false, workloadImpact: 0 } as const;
const describedDesign = { coverageLevel: "mentioned", verificationStatus: "document_statement_only",
  supportBoundary: { directlySupports: ["The topic is mentioned."], indirectlySupports: [], doesNotSupport: ["The mechanism is demonstrated."] } } as const;

const gap = assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "The application already proposes operando Raman.", evidenceTier: "structural_evidence",
      coverageLevel: "planned", verificationStatus: "document_statement_only", supportBoundary: {
        directlySupports: ["Operando Raman is planned."], indirectlySupports: [],
        doesNotSupport: ["Field-dependent bridge rearrangement is demonstrated."],
      } }],
    disposition: "residual_gap_found", residualGap: "It does not resolve field-dependent bridge rearrangement.",
    reasonExistingDesignIsInsufficient: "The stated analysis observes bands but does not compare biased states.",
    recommendation: "Add biased-state comparison to the existing Raman and simulation task.", unableToVerifyReason: null,
    scopeSignals: { coreQuestionMatch: 2, researchObjectMatch: 2, mechanismMatch: 2, plannedMethodMatch: 1,
      introducesNewObject: false, introducesNewMethodChain: false, introducesNewEvaluationSystem: false, workloadImpact: 1 },
  }],
} });
assert.equal(gap[0]?.existingDesign[0]?.sectionId, sectionId);
assert.equal(gap[0]?.latestDevelopment.mechanismSummary, assessment.mechanismSummary,
  "latest development must be reused from validated source assessment rather than regenerated");
assert.equal(gap[0]?.recommendation, "Add biased-state comparison to the existing Raman and simulation task.");
assert.equal(gap[0]?.scopeDecision.finalDecision, "main_suggestion");
assert.equal(gap[0]?.existingDesign[0]?.verificationStatus, "document_statement_only");

const noGap = assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "The application already covers the mechanism.", evidenceTier: "mechanistic_evidence",
      coverageLevel: "completed_result", verificationStatus: "data_or_figure_present", supportBoundary: {
        directlySupports: ["The mechanism is covered."], indirectlySupports: [], doesNotSupport: [],
      } }],
    disposition: "verified_no_residual_gap", residualGap: null,
    reasonExistingDesignIsInsufficient: null, recommendation: null, unableToVerifyReason: null,
    scopeSignals: { coreQuestionMatch: 2, researchObjectMatch: 2, mechanismMatch: 2, plannedMethodMatch: 1,
      introducesNewObject: false, introducesNewMethodChain: false, introducesNewEvaluationSystem: false, workloadImpact: 0 },
  }],
} });
assert.equal(noGap[0]?.recommendation, null, "verified no-gap results must not manufacture a recommendation");
assert.equal(noGap[0]?.rejectedSuggestion?.rejectionReason, "already_covered");

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "not_found", existingDesign: [], disposition: "verified_no_residual_gap",
    residualGap: null, reasonExistingDesignIsInsufficient: null, recommendation: "Add another experiment.", unableToVerifyReason: null,
    scopeSignals }],
} }), /cannot publish/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found", existingDesign: [{ locationRef: "N99", summary: "Invented location", evidenceTier: "description_only", ...describedDesign }],
    disposition: "residual_gap_found", residualGap: "The design remains incomplete.",
    reasonExistingDesignIsInsufficient: "The referenced design would not test the mechanism.",
    recommendation: "Add a bounded validation.", unableToVerifyReason: null, scopeSignals }],
} }), /outside the frozen/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "A located design", evidenceTier: "description_only", ...describedDesign }],
    disposition: "unable_to_verify", residualGap: null, reasonExistingDesignIsInsufficient: null,
    recommendation: null, unableToVerifyReason: "ambiguous_application_mapping", scopeSignals }],
} }), /must agree/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "not_found",
    existingDesign: [{ locationRef: "N1", summary: "Contradictory design", evidenceTier: "description_only", ...describedDesign }],
    disposition: "residual_gap_found", residualGap: "A gap", reasonExistingDesignIsInsufficient: "No adequate design",
    recommendation: "Add validation", unableToVerifyReason: null, scopeSignals }],
} }), /Only a found/u);

const adjacent = assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "not_found", existingDesign: [],
    disposition: "residual_gap_found", residualGap: "Lifecycle analysis is absent.",
    reasonExistingDesignIsInsufficient: "The application does not contain lifecycle analysis.",
    recommendation: "Add a complete lifecycle assessment work package.", unableToVerifyReason: null,
    scopeSignals: { coreQuestionMatch: 0, researchObjectMatch: 1, mechanismMatch: 0, plannedMethodMatch: 0,
      introducesNewObject: false, introducesNewMethodChain: true, introducesNewEvaluationSystem: true, workloadImpact: 3 } }],
} });
assert.equal(adjacent[0]?.scopeDecision.finalDecision, "reject");
assert.equal(adjacent[0]?.rejectedSuggestion?.rejectionReason, "adjacent_topic");

console.log("Research latest-development, existing-design and residual-gap comparison discipline verified offline.");
