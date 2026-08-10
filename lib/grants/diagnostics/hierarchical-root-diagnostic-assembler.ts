import {
  GrantRootDiagnosticProviderResultV1Schema,
  GrantRootDiagnosticResultV1Schema,
  type GrantRootDiagnosticProviderResultV1,
  type GrantRootDiagnosticResultV1,
} from "./hierarchical-semantic-contracts.ts";

export type GrantRootDiagnosticNormalizationActionV1 = {
  path: string;
  rule:
    | "affected_role_duplicate_removed"
    | "evidence_id_duplicate_removed"
    | "empty_quote_to_null"
    | "related_location_duplicate_removed"
    | "invalid_related_location_removed"
    | "invalid_occurrence_primary_removed"
    | "duplicate_occurrence_removed"
    | "finding_invalid_evidence_removed"
    | "finding_without_occurrence_removed";
};

export function assembleGrantRootDiagnosticResultV1(input: {
  providerResult: GrantRootDiagnosticProviderResultV1;
  locationByRef: ReadonlyMap<string, { sectionId: string; nodeId: string }>;
  allowedEvidenceCardIds: ReadonlySet<string>;
}): {
  result: GrantRootDiagnosticResultV1;
  actions: GrantRootDiagnosticNormalizationActionV1[];
  invalidLocationPaths: string[];
  invalidEvidencePaths: string[];
} {
  const providerResult = GrantRootDiagnosticProviderResultV1Schema.parse(input.providerResult);
  const actions: GrantRootDiagnosticNormalizationActionV1[] = [];
  const invalidLocationPaths: string[] = [];
  const invalidEvidencePaths: string[] = [];
  const rootFindings = providerResult.rootFindings.flatMap((finding, findingIndex) => {
    const seenRoles = new Set<string>();
    const affectedArgumentRoles = finding.affectedArgumentRoles.filter((role, roleIndex) => {
      if (seenRoles.has(role)) {
        actions.push({ path: `rootFindings.${findingIndex}.affectedArgumentRoles.${roleIndex}`, rule: "affected_role_duplicate_removed" });
        return false;
      }
      seenRoles.add(role);
      return true;
    });

    const seenEvidence = new Set<string>();
    const usedEvidenceCardIds = finding.usedEvidenceCardIds.filter((cardId, evidenceIndex) => {
      if (seenEvidence.has(cardId)) {
        actions.push({ path: `rootFindings.${findingIndex}.usedEvidenceCardIds.${evidenceIndex}`, rule: "evidence_id_duplicate_removed" });
        return false;
      }
      seenEvidence.add(cardId);
      return true;
    });
    const invalidEvidenceIndex = usedEvidenceCardIds.findIndex((cardId) => !input.allowedEvidenceCardIds.has(cardId));
    if (invalidEvidenceIndex >= 0) {
      const path = `rootFindings.${findingIndex}.usedEvidenceCardIds.${invalidEvidenceIndex}`;
      invalidEvidencePaths.push(path);
      actions.push({ path, rule: "finding_invalid_evidence_removed" });
      return [];
    }

    const seenOccurrences = new Set<string>();
    const occurrences = finding.occurrences.flatMap((occurrence, occurrenceIndex) => {
      const primaryLocation = input.locationByRef.get(occurrence.primaryLocationRef);
      if (!primaryLocation) {
        const path = `rootFindings.${findingIndex}.occurrences.${occurrenceIndex}.primaryLocationRef`;
        invalidLocationPaths.push(path);
        actions.push({ path, rule: "invalid_occurrence_primary_removed" });
        return [];
      }
      const seenRelated = new Set<string>();
      const relatedLocations = occurrence.relatedLocations.flatMap((related, relatedIndex) => {
        const key = `${related.locationRef}:${related.role}`;
        if (seenRelated.has(key)) {
          actions.push({ path: `rootFindings.${findingIndex}.occurrences.${occurrenceIndex}.relatedLocations.${relatedIndex}`, rule: "related_location_duplicate_removed" });
          return [];
        }
        seenRelated.add(key);
        const resolved = input.locationByRef.get(related.locationRef);
        if (!resolved) {
          const path = `rootFindings.${findingIndex}.occurrences.${occurrenceIndex}.relatedLocations.${relatedIndex}.locationRef`;
          invalidLocationPaths.push(path);
          actions.push({ path, rule: "invalid_related_location_removed" });
          return [];
        }
        const quote = related.quote !== null && related.quote.trim().length === 0 ? null : related.quote;
        if (quote === null && related.quote !== null) {
          actions.push({ path: `rootFindings.${findingIndex}.occurrences.${occurrenceIndex}.relatedLocations.${relatedIndex}.quote`, rule: "empty_quote_to_null" });
        }
        return [{ ...resolved, role: related.role, quote }];
      });
      const occurrenceKey = JSON.stringify({
        primaryNodeId: primaryLocation.nodeId,
        related: relatedLocations.map((related) => [related.nodeId, related.role]).sort(),
      });
      if (seenOccurrences.has(occurrenceKey)) {
        actions.push({ path: `rootFindings.${findingIndex}.occurrences.${occurrenceIndex}`, rule: "duplicate_occurrence_removed" });
        return [];
      }
      seenOccurrences.add(occurrenceKey);
      return [{ primaryLocation, relatedLocations }];
    });
    if (occurrences.length === 0) {
      const path = `rootFindings.${findingIndex}.occurrences`;
      invalidLocationPaths.push(path);
      actions.push({ path, rule: "finding_without_occurrence_removed" });
      return [];
    }
    return [{
      ...finding,
      affectedArgumentRoles,
      occurrences,
      usedEvidenceCardIds,
    }];
  });

  return {
    result: GrantRootDiagnosticResultV1Schema.parse({ rootFindings }),
    actions,
    invalidLocationPaths,
    invalidEvidencePaths,
  };
}
