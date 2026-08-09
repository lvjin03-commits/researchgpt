import { sha256Canonical } from "../domain/canonical-json.ts";
import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";

export type GrantDiagnosticImpact = {
  sectionIds: string[];
  coverageRatio: number;
};

export function analyzeGrantDiagnosticImpact(
  current: CanonicalGrantSnapshot,
  previous: CanonicalGrantSnapshot,
): GrantDiagnosticImpact {
  const previousSections = new Map(previous.sections.map((section) => [section.sectionId, section]));
  const previousNodes = new Map(previous.nodes.map((node) => [node.nodeId, sha256Canonical(node)]));
  const changed = new Set<string>();
  for (const section of current.sections) {
    const old = previousSections.get(section.sectionId);
    if (!old || sha256Canonical(section) !== sha256Canonical(old)) changed.add(section.sectionId);
  }
  for (const node of current.nodes) {
    if (previousNodes.get(node.nodeId) !== sha256Canonical(node)) changed.add(node.sectionId);
  }
  for (const old of previous.sections) {
    if (!current.sections.some((section) => section.sectionId === old.sectionId)) {
      const parent = old.parentSectionId && current.sections.some((section) => section.sectionId === old.parentSectionId)
        ? old.parentSectionId
        : current.sections[0]?.sectionId;
      if (parent) changed.add(parent);
    }
  }
  return {
    sectionIds: [...changed],
    coverageRatio: current.sections.length === 0 ? 1 : changed.size / current.sections.length,
  };
}
