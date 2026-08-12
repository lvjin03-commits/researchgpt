import { createHash } from "node:crypto";
import {
  GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS,
  GrantFactMapProviderResultV1Schema,
  GrantFactMapV1Schema,
  GrantSemanticObjectTypeV1Schema,
  GrantSemanticObjectV1Schema,
} from "./semantic-review-v6-contracts.ts";
import type { GrantSemanticReviewV6PreparedInputV1 } from "./semantic-review-v6-input.ts";

export type GrantFactMapIssueCodeV1 =
  | "provider_output_invalid"
  | "semantic_object_limit_exceeded"
  | "semantic_object_invalid"
  | "semantic_facet_invalid"
  | "source_location_missing"
  | "source_location_duplicate"
  | "source_location_unknown"
  | "source_location_empty";

export type GrantFactMapIssueV1 = {
  code: GrantFactMapIssueCodeV1;
  path: string;
};

export type AssembleGrantFactMapResultV1 =
  | { success: true; factMap: ReturnType<typeof GrantFactMapV1Schema.parse> }
  | { success: false; issues: GrantFactMapIssueV1[] };

function anchorHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Program-owned Fact Map assembly. Model output contains no internal IDs.
 * Atomic N* aliases resolve through the one frozen Model Data Gateway scope;
 * S* references, canonical IDs, ranges and hashes are assigned here.
 */
export function assembleGrantFactMapV1(input: {
  prepared: GrantSemanticReviewV6PreparedInputV1;
  providerResult: unknown;
}): AssembleGrantFactMapResultV1 {
  const provider = GrantFactMapProviderResultV1Schema.safeParse(input.providerResult);
  if (!provider.success) {
    return { success: false, issues: [{ code: "provider_output_invalid", path: "providerResult" }] };
  }
  if (provider.data.semanticObjects.length > 256) {
    return { success: false, issues: [{ code: "semantic_object_limit_exceeded", path: "semanticObjects" }] };
  }

  const nodeByLocationRef = new Map(input.prepared.factMapRequest.sections.flatMap((section) =>
    section.nodes.map((node) => [node.locationRef, node] as const)));
  const issues: GrantFactMapIssueV1[] = [];
  const semanticObjects: ReturnType<typeof GrantSemanticObjectV1Schema.parse>[] = [];

  provider.data.semanticObjects.forEach((candidate, objectIndex) => {
    if (!GrantSemanticObjectTypeV1Schema.safeParse(candidate.objectType).success) {
      issues.push({ code: "semantic_object_invalid", path: `semanticObjects.${objectIndex}.objectType` });
      return;
    }
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(candidate.normalizedFacet)) {
      issues.push({ code: "semantic_facet_invalid", path: `semanticObjects.${objectIndex}.normalizedFacet` });
    }
    if (candidate.sourceLocationRefs.length === 0) {
      issues.push({ code: "source_location_missing", path: `semanticObjects.${objectIndex}.sourceLocationRefs` });
    }
    const seenLocations = new Set<string>();
    const anchors = candidate.sourceLocationRefs.flatMap((locationRef, locationIndex) => {
      if (seenLocations.has(locationRef)) {
        issues.push({
          code: "source_location_duplicate",
          path: `semanticObjects.${objectIndex}.sourceLocationRefs.${locationIndex}`,
        });
        return [];
      }
      seenLocations.add(locationRef);
      const canonical = input.prepared.locationByRef.get(locationRef);
      const node = nodeByLocationRef.get(locationRef);
      if (!canonical || !node) {
        issues.push({
          code: "source_location_unknown",
          path: `semanticObjects.${objectIndex}.sourceLocationRefs.${locationIndex}`,
        });
        return [];
      }
      if (node.text.length === 0) {
        issues.push({
          code: "source_location_empty",
          path: `semanticObjects.${objectIndex}.sourceLocationRefs.${locationIndex}`,
        });
        return [];
      }
      return [{
        sourceRevisionId: input.prepared.sourceRevisionId,
        sectionId: canonical.sectionId,
        nodeId: canonical.nodeId,
        startOffset: 0,
        endOffset: node.text.length,
        anchorHash: anchorHash(node.text),
      }];
    });
    const parsed = GrantSemanticObjectV1Schema.safeParse({
      schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.semanticObjectSchemaVersion,
      sourceRevisionId: input.prepared.sourceRevisionId,
      semanticObjectRef: `S${objectIndex + 1}`,
      objectType: candidate.objectType,
      normalizedFacet: candidate.normalizedFacet,
      anchors,
    });
    if (!parsed.success) {
      issues.push({ code: "semantic_object_invalid", path: `semanticObjects.${objectIndex}` });
      return;
    }
    semanticObjects.push(parsed.data);
  });

  if (issues.length > 0) return { success: false, issues };
  const factMap = GrantFactMapV1Schema.safeParse({
    schemaVersion: GRANT_SEMANTIC_REVIEW_V6_TARGET_VERSIONS.factMapSchemaVersion,
    sourceRevisionId: input.prepared.sourceRevisionId,
    locationScopeFingerprint: input.prepared.locationScopeFingerprint,
    semanticObjects,
  });
  if (!factMap.success) {
    return { success: false, issues: [{ code: "semantic_object_invalid", path: "factMap" }] };
  }
  return { success: true, factMap: factMap.data };
}

export function buildGrantFactMapSystemPromptV1(language: "zh" | "en"): string {
  const outputLanguage = language === "zh" ? "简体中文" : "English";
  return [
    "You build a descriptive Fact Map for an NSFC grant application.",
    "Identify only explicit scientific questions, innovation claims, research objectives, research content, technical routes, mechanism claims, expected metrics, preliminary evidence and expected contributions.",
    "Do not diagnose, criticize, rank, recommend changes, predict funding outcomes or create Findings.",
    "Every semantic object must select one or more exact N* sourceLocationRefs supplied in the input. Never invent or combine IDs.",
    "normalizedFacet is a short lower_snake_case semantic label, not prose and not an internal ID.",
    "Do not infer absent objects. Do not treat headings alone as evidence of substantive content.",
    `Use ${outputLanguage} only for model reasoning; the structured result contains no explanatory prose.`,
  ].join("\n");
}
