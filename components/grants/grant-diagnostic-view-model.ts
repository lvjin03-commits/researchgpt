import type { GrantAnchorResolution, GrantDiagnosticConflict } from "@/lib/grants/diagnostics/contracts";
import type { GrantNormalizedFinding } from "@/lib/grants/diagnostics/normalized-finding";
import type { GrantFindingFeedback } from "@/lib/grants/feedback/contracts";
import type { GrantDiagnosticCoverage, GrantRecheckSummary } from "@/lib/grants/application/diagnostic-service";

export type GrantDiagnosticItem = {
  finding: GrantNormalizedFinding;
  resolution: GrantAnchorResolution;
};

export type GrantDiagnosticsPayload = {
  findings: GrantDiagnosticItem[];
  conflicts: GrantDiagnosticConflict[];
  feedback: GrantFindingFeedback[];
  recheck: GrantRecheckSummary;
  coverage: GrantDiagnosticCoverage;
};

export type GrantFindingTarget = {
  findingId: string;
  sectionId?: string;
  nodeId?: string;
  navigable: boolean;
};

export function grantFindingTarget(item: GrantDiagnosticItem): GrantFindingTarget {
  const resolvedNodeId = item.resolution.status === "exact" || item.resolution.status === "relocated"
    ? item.resolution.targetNodeId
    : undefined;
  return {
    findingId: item.finding.findingId,
    sectionId: item.finding.sourceAnchor.sectionId,
    nodeId: resolvedNodeId,
    navigable: Boolean(resolvedNodeId),
  };
}

export function indexGrantFindingsByNode(items: GrantDiagnosticItem[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const item of items) {
    const target = grantFindingTarget(item);
    if (!target.nodeId) continue;
    index.set(target.nodeId, [...(index.get(target.nodeId) ?? []), target.findingId]);
  }
  return index;
}

export function indexGrantFindingFeedback(items: GrantFindingFeedback[]): Map<string, GrantFindingFeedback> {
  return new Map(items.map((item) => [item.findingId, item]));
}
