import {
  assembleGrantFactMapCoverageV1,
  GrantScientificFindingContentV1Schema,
  GrantScientificReviewProviderResultV1Schema,
  type GrantFactMapCoverageReportV1,
  type GrantFactMapV1,
  type GrantScientificFindingContentV1,
} from "./semantic-review-v6-contracts.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

export type GrantScientificReviewAssemblyIssueCodeV1 =
  | "provider_output_invalid"
  | "finding_limit_exceeded"
  | "finding_ref_invalid"
  | "finding_ref_duplicate"
  | "semantic_object_ref_invalid"
  | "primary_location_invalid"
  | "existing_design_location_invalid"
  | "evidence_reference_invalid"
  | "evidence_scope_invalid"
  | "finding_content_invalid"
  | "coverage_invalid";

export type GrantScientificReviewAssemblyIssueV1 = {
  code: GrantScientificReviewAssemblyIssueCodeV1;
  path: string;
};

export type GrantScientificReviewNormalizationActionV1 = {
  code: "drop_invalid_related_location" | "drop_duplicate_related_location";
  path: string;
};

export type AssembleGrantScientificReviewResultV1 =
  | {
      success: true;
      scientificFindings: GrantScientificFindingContentV1[];
      coverageReport: GrantFactMapCoverageReportV1;
      actions: GrantScientificReviewNormalizationActionV1[];
    }
  | {
      success: false;
      issues: GrantScientificReviewAssemblyIssueV1[];
      actions: GrantScientificReviewNormalizationActionV1[];
    };

const FindingRefPattern = /^F[1-9]\d*$/;

/**
 * Resolves all provider aliases through the frozen gateway scope, enforces
 * evidence authorization and runs the coverage quality gate. It normalizes
 * only invalid/duplicate related locations; it never rewrites scientific
 * meaning, evidence tier or the residual-gap conclusion.
 */
export function assembleGrantScientificReviewV1(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  factMap: GrantFactMapV1;
  providerResult: unknown;
}): AssembleGrantScientificReviewResultV1 {
  const provider = GrantScientificReviewProviderResultV1Schema.safeParse(input.providerResult);
  if (!provider.success) {
    return {
      success: false,
      issues: [{ code: "provider_output_invalid", path: "providerResult" }],
      actions: [],
    };
  }

  const issues: GrantScientificReviewAssemblyIssueV1[] = [];
  const actions: GrantScientificReviewNormalizationActionV1[] = [];
  if (provider.data.findings.length > 16) {
    issues.push({ code: "finding_limit_exceeded", path: "findings" });
  }
  const knownSemanticObjectRefs = new Set(input.factMap.semanticObjects.map((object) => object.semanticObjectRef));
  const evidenceById = new Map(input.prepared.reviewBaseRequest.evidenceCards.map((card) => [card.cardId, card]));
  const seenFindingRefs = new Set<string>();
  const scientificFindings: GrantScientificFindingContentV1[] = [];

  const resolveLocation = (locationRef: string): { sectionId: string; nodeId: string } | undefined =>
    input.prepared.locationByRef.get(locationRef);

  provider.data.findings.forEach((candidate, findingIndex) => {
    let publishable = true;
    if (!FindingRefPattern.test(candidate.findingRef)) {
      issues.push({ code: "finding_ref_invalid", path: `findings.${findingIndex}.findingRef` });
      publishable = false;
    }
    if (seenFindingRefs.has(candidate.findingRef)) {
      issues.push({ code: "finding_ref_duplicate", path: `findings.${findingIndex}.findingRef` });
      publishable = false;
    }
    seenFindingRefs.add(candidate.findingRef);

    if (candidate.semanticObjectRefs.length === 0
      || new Set(candidate.semanticObjectRefs).size !== candidate.semanticObjectRefs.length
      || candidate.semanticObjectRefs.some((ref) => !knownSemanticObjectRefs.has(ref))) {
      issues.push({ code: "semantic_object_ref_invalid", path: `findings.${findingIndex}.semanticObjectRefs` });
      publishable = false;
    }

    const primaryLocation = resolveLocation(candidate.primaryLocationRef);
    if (!primaryLocation) {
      issues.push({ code: "primary_location_invalid", path: `findings.${findingIndex}.primaryLocationRef` });
      publishable = false;
    }

    const existingDesign = candidate.existingDesign.flatMap((design, designIndex) => {
      const location = resolveLocation(design.locationRef);
      if (!location) {
        issues.push({
          code: "existing_design_location_invalid",
          path: `findings.${findingIndex}.existingDesign.${designIndex}.locationRef`,
        });
        publishable = false;
        return [];
      }
      return [{ ...location, summary: design.summary, evidenceTier: design.evidenceTier }];
    });

    const seenRelated = new Set<string>();
    const relatedLocations = candidate.relatedLocations.flatMap((related, relatedIndex) => {
      const path = `findings.${findingIndex}.relatedLocations.${relatedIndex}.locationRef`;
      const location = resolveLocation(related.locationRef);
      if (!location) {
        actions.push({ code: "drop_invalid_related_location", path });
        return [];
      }
      const key = `${location.sectionId}:${location.nodeId}:${related.role}`;
      if (seenRelated.has(key)) {
        actions.push({ code: "drop_duplicate_related_location", path });
        return [];
      }
      seenRelated.add(key);
      return [{ ...location, role: related.role }];
    });

    const evidenceIds = candidate.usedEvidenceCardIds;
    if (new Set(evidenceIds).size !== evidenceIds.length
      || evidenceIds.some((cardId) => !input.prepared.allowedEvidenceCardIds.has(cardId) || !evidenceById.has(cardId))) {
      issues.push({ code: "evidence_reference_invalid", path: `findings.${findingIndex}.usedEvidenceCardIds` });
      publishable = false;
    }
    if (candidate.evidenceBasis === "authorized_evidence"
      && evidenceIds.some((cardId) => evidenceById.get(cardId)?.verificationStatus !== "verified")) {
      issues.push({ code: "evidence_scope_invalid", path: `findings.${findingIndex}.usedEvidenceCardIds` });
      publishable = false;
    }
    if (candidate.evidenceBasis !== "authorized_evidence" && evidenceIds.length > 0) {
      issues.push({ code: "evidence_scope_invalid", path: `findings.${findingIndex}.usedEvidenceCardIds` });
      publishable = false;
    }

    if (!publishable || !primaryLocation) return;
    const parsed = GrantScientificFindingContentV1Schema.safeParse({
      findingRef: candidate.findingRef,
      category: candidate.category,
      semanticObjectRefs: candidate.semanticObjectRefs,
      title: candidate.title,
      diagnosticFact: candidate.diagnosticFact,
      existingDesign,
      residualGap: candidate.residualGap,
      reasonExistingDesignIsInsufficient: candidate.reasonExistingDesignIsInsufficient,
      recommendation: candidate.recommendation,
      possibleReviewerQuestion: candidate.possibleReviewerQuestion,
      assessment: candidate.assessment,
      primaryLocation,
      relatedLocations,
      evidenceBasis: candidate.evidenceBasis,
      usedEvidenceCardIds: evidenceIds,
    });
    if (!parsed.success) {
      issues.push({ code: "finding_content_invalid", path: `findings.${findingIndex}` });
      return;
    }
    scientificFindings.push(parsed.data);
  });

  const coverage = assembleGrantFactMapCoverageV1({
    sourceRevisionId: input.prepared.sourceRevisionId,
    semanticObjects: input.factMap.semanticObjects,
    providerResult: { coverageItems: provider.data.coverageItems },
    validFindingRefs: scientificFindings.map((finding) => finding.findingRef),
  });
  if (!coverage.success) {
    coverage.issues.forEach((issue) => issues.push({ code: "coverage_invalid", path: issue.path }));
  }
  if (issues.length > 0 || !coverage.success) return { success: false, issues, actions };
  return {
    success: true,
    scientificFindings,
    coverageReport: coverage.report,
    actions,
  };
}

