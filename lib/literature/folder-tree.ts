import type { LiteratureFolder } from "@/lib/literature/types";

export type FolderTreeNode = {
  folder: LiteratureFolder;
  depth: number;
};

export function flattenFolderTree(folders: LiteratureFolder[]): FolderTreeNode[] {
  const byParent = new Map<string | null, LiteratureFolder[]>();

  for (const folder of folders) {
    const parentKey = folder.parentId ?? null;
    const siblings = byParent.get(parentKey) ?? [];
    siblings.push(folder);
    byParent.set(parentKey, siblings);
  }

  const result: FolderTreeNode[] = [];

  function walk(parentId: string | null, depth: number) {
    const children = (byParent.get(parentId) ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, "zh-CN"),
    );

    for (const folder of children) {
      result.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  }

  walk(null, 0);
  return result;
}

export function formatFolderTreeLabel(name: string, depth: number): string {
  if (depth <= 0) {
    return name;
  }

  return `${"　".repeat(depth)}└ ${name}`;
}
