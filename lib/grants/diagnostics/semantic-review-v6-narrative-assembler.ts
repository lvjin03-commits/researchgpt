import {
  GrantNarrativeFindingContentV1Schema,
  GrantNarrativeFindingProviderResultV1Schema,
  type GrantNarrativeFindingContentV1,
} from "./semantic-review-v6-contracts.ts";
import type { GrantNarrativeReviewPreparedInputV1 } from "./semantic-review-v6-narrative-input.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

export type GrantNarrativeReviewAssemblyIssueV1 = {
  code:
    | "provider_output_invalid"
    | "finding_limit_exceeded"
    | "finding_ref_invalid"
    | "finding_ref_duplicate"
    | "primary_location_invalid"
    | "image_reference_invalid"
    | "image_scope_invalid"
    | "finding_content_invalid";
  path: string;
};

export type GrantNarrativeReviewNormalizationActionV1 = {
  code: "drop_invalid_related_location" | "drop_duplicate_related_location";
  path: string;
};

export type AssembleGrantNarrativeReviewResultV1 =
  | { success: true; narrativeFindings: GrantNarrativeFindingContentV1[]; actions: GrantNarrativeReviewNormalizationActionV1[] }
  | { success: false; issues: GrantNarrativeReviewAssemblyIssueV1[]; actions: GrantNarrativeReviewNormalizationActionV1[] };

const FindingRefPattern = /^F[1-9]\d*$/;

/** Resolves provider aliases through the frozen document and current image
 * admission. It never turns narrative advice into scientific diagnosis. */
export function assembleGrantNarrativeReviewV1(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  narrative: GrantNarrativeReviewPreparedInputV1;
  providerResult: unknown;
}): AssembleGrantNarrativeReviewResultV1 {
  const provider = GrantNarrativeFindingProviderResultV1Schema.safeParse(input.providerResult);
  if (!provider.success) return { success: false, issues: [{ code: "provider_output_invalid", path: "providerResult" }], actions: [] };
  const issues: GrantNarrativeReviewAssemblyIssueV1[] = [];
  const actions: GrantNarrativeReviewNormalizationActionV1[] = [];
  if (provider.data.findings.length > 16) issues.push({ code: "finding_limit_exceeded", path: "findings" });
  const seenFindingRefs = new Set<string>();
  const narrativeFindings: GrantNarrativeFindingContentV1[] = [];

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
    const primaryLocation = input.prepared.locationByRef.get(candidate.primaryLocationRef);
    if (!primaryLocation) {
      issues.push({ code: "primary_location_invalid", path: `findings.${findingIndex}.primaryLocationRef` });
      publishable = false;
    }

    const seenRelated = new Set<string>();
    const relatedLocations = candidate.relatedLocations.flatMap((related, relatedIndex) => {
      const path = `findings.${findingIndex}.relatedLocations.${relatedIndex}.locationRef`;
      const location = input.prepared.locationByRef.get(related.locationRef);
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

    const imageRefs = candidate.usedImageRefs;
    if (new Set(imageRefs).size !== imageRefs.length || imageRefs.some((ref) => !input.narrative.imageAssetIdByRef.has(ref))) {
      issues.push({ code: "image_reference_invalid", path: `findings.${findingIndex}.usedImageRefs` });
      publishable = false;
    }
    if ((candidate.category === "visual_communication") !== (imageRefs.length > 0)
      || (candidate.category === "visual_communication" && candidate.affectedScope !== "figure")) {
      issues.push({ code: "image_scope_invalid", path: `findings.${findingIndex}.usedImageRefs` });
      publishable = false;
    }
    if (!publishable || !primaryLocation) return;
    const parsed = GrantNarrativeFindingContentV1Schema.safeParse({
      findingRef: candidate.findingRef,
      category: candidate.category,
      title: candidate.title,
      observedPresentation: candidate.observedPresentation,
      readerFriction: candidate.readerFriction,
      suggestedOrganization: candidate.suggestedOrganization,
      affectedScope: candidate.affectedScope,
      assessment: candidate.assessment,
      primaryLocation,
      relatedLocations,
      usedFigureAssetIds: imageRefs.map((ref) => input.narrative.imageAssetIdByRef.get(ref)!),
    });
    if (!parsed.success) {
      issues.push({ code: "finding_content_invalid", path: `findings.${findingIndex}` });
      return;
    }
    narrativeFindings.push(parsed.data);
  });
  if (issues.length > 0) return { success: false, issues, actions };
  return { success: true, narrativeFindings, actions };
}
