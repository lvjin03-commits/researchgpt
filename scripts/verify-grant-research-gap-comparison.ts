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

const gap = assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "The application already proposes operando Raman.", evidenceTier: "structural_evidence" }],
    disposition: "residual_gap_found", residualGap: "It does not resolve field-dependent bridge rearrangement.",
    reasonExistingDesignIsInsufficient: "The stated analysis observes bands but does not compare biased states.",
    recommendation: "Add biased-state comparison to the existing Raman and simulation task.", unableToVerifyReason: null,
  }],
} });
assert.equal(gap[0]?.existingDesign[0]?.sectionId, sectionId);
assert.equal(gap[0]?.latestDevelopment.mechanismSummary, assessment.mechanismSummary,
  "latest development must be reused from validated source assessment rather than regenerated");
assert.equal(gap[0]?.recommendation, "Add biased-state comparison to the existing Raman and simulation task.");

const noGap = assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "The application already covers the mechanism.", evidenceTier: "mechanistic_evidence" }],
    disposition: "verified_no_residual_gap", residualGap: null,
    reasonExistingDesignIsInsufficient: null, recommendation: null, unableToVerifyReason: null,
  }],
} });
assert.equal(noGap[0]?.recommendation, null, "verified no-gap results must not manufacture a recommendation");

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "not_found", existingDesign: [], disposition: "verified_no_residual_gap",
    residualGap: null, reasonExistingDesignIsInsufficient: null, recommendation: "Add another experiment.", unableToVerifyReason: null }],
} }), /cannot publish/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId,
    existingDesignStatus: "found", existingDesign: [{ locationRef: "N99", summary: "Invented location", evidenceTier: "description_only" }],
    disposition: "residual_gap_found", residualGap: "The design remains incomplete.",
    reasonExistingDesignIsInsufficient: "The referenced design would not test the mechanism.",
    recommendation: "Add a bounded validation.", unableToVerifyReason: null }],
} }), /outside the frozen/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "found",
    existingDesign: [{ locationRef: "N1", summary: "A located design", evidenceTier: "description_only" }],
    disposition: "unable_to_verify", residualGap: null, reasonExistingDesignIsInsufficient: null,
    recommendation: null, unableToVerifyReason: "ambiguous_application_mapping" }],
} }), /must agree/u);

assert.throws(() => assembleGrantResearchGapComparisons({ assessments: [assessment], locationByRef: locations, providerResult: {
  schemaVersion: 1, comparisons: [{ sourceGroupId, existingDesignStatus: "not_found",
    existingDesign: [{ locationRef: "N1", summary: "Contradictory design", evidenceTier: "description_only" }],
    disposition: "residual_gap_found", residualGap: "A gap", reasonExistingDesignIsInsufficient: "No adequate design",
    recommendation: "Add validation", unableToVerifyReason: null }],
} }), /Only a found/u);

console.log("Research latest-development, existing-design and residual-gap comparison discipline verified offline.");
