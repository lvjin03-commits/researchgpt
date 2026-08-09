import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";

export type GrantSectionProjection = {
  section: CanonicalGrantSnapshot["sections"][number];
  depth: number;
};

function orderedChildren(snapshot: CanonicalGrantSnapshot, parentSectionId?: string) {
  return snapshot.sections
    .filter((section) => section.parentSectionId === parentSectionId)
    .sort((left, right) => left.order - right.order);
}

export function projectGrantSectionTree(snapshot: CanonicalGrantSnapshot): GrantSectionProjection[] {
  const result: GrantSectionProjection[] = [];
  const visit = (parentSectionId: string | undefined, depth: number) => {
    for (const section of orderedChildren(snapshot, parentSectionId)) {
      result.push({ section, depth });
      visit(section.sectionId, depth + 1);
    }
  };
  visit(undefined, 0);
  return result;
}

export function projectGrantSectionSubtree(
  snapshot: CanonicalGrantSnapshot,
  selectedSectionId: string | null,
): GrantSectionProjection[] {
  if (!selectedSectionId) return [];
  const root = snapshot.sections.find((section) => section.sectionId === selectedSectionId);
  if (!root) return [];
  const result: GrantSectionProjection[] = [{ section: root, depth: 0 }];
  const visit = (parentSectionId: string, depth: number) => {
    for (const section of orderedChildren(snapshot, parentSectionId)) {
      result.push({ section, depth });
      visit(section.sectionId, depth + 1);
    }
  };
  visit(root.sectionId, 1);
  return result;
}

export function grantSectionBreadcrumbs(
  snapshot: CanonicalGrantSnapshot,
  selectedSectionId: string | null,
) {
  const byId = new Map(snapshot.sections.map((section) => [section.sectionId, section]));
  const result: CanonicalGrantSnapshot["sections"] = [];
  let current = selectedSectionId ? byId.get(selectedSectionId) : undefined;
  const visited = new Set<string>();
  while (current && !visited.has(current.sectionId)) {
    visited.add(current.sectionId);
    result.unshift(current);
    current = current.parentSectionId ? byId.get(current.parentSectionId) : undefined;
  }
  return result;
}
