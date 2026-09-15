import type { GrantAssistantAnswerMode } from "../assistant/context-plan-contracts.ts";
import { GrantDocumentMemorySnapshotSchema, type GrantDocumentMemorySnapshot } from
  "../assistant/document-memory-contracts.ts";

export type GrantAssistantPlanningProjection = {
  modelText: string;
  sectionIdByAlias: Map<string, string>;
  memoryItemIdByAlias: Map<string, string>;
};

function singleLine(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

function cognitionItemIds(memory: GrantDocumentMemorySnapshot, maximumPerKind: number) {
  return [...new Set(Object.values(memory.l0.itemIdsByKind)
    .flatMap((ids) => ids.slice(0, maximumPerKind)))];
}

function descendantMemorySectionIds(memory: GrantDocumentMemorySnapshot, requested: ReadonlySet<string>) {
  const included = new Set(requested);
  let changed = true;
  while (changed) {
    changed = false;
    for (const section of memory.l1.sections) {
      if (section.parentSectionId && included.has(section.parentSectionId) && !included.has(section.sectionId)) {
        included.add(section.sectionId);
        changed = true;
      }
    }
  }
  return included;
}

export function buildGrantAssistantPlanningProjection(
  memoryInput: GrantDocumentMemorySnapshot,
): GrantAssistantPlanningProjection {
  const memory = GrantDocumentMemorySnapshotSchema.parse(memoryInput);
  const sectionIdByAlias = new Map(memory.l1.sections.map((section, index) => [`S${index + 1}`, section.sectionId]));
  const memoryItemIdByAlias = new Map(memory.l1.items.map((item) => [item.memoryItemId, item.memoryItemId]));
  const sectionAliasById = new Map([...sectionIdByAlias].map(([alias, sectionId]) => [sectionId, alias]));
  const modelText = [
    `L0 全文认知：${singleLine(memory.l0.overview)}`,
    "L1 章节索引：",
    ...memory.l1.sections.map((section, index) =>
      `[S${index + 1}] ${singleLine(section.title)} | ${singleLine(section.semanticRole)} | ${singleLine(section.summary)}`),
    "L1 语义项索引：",
    ...memory.l1.items.map((item) => {
      const sectionAliases = item.sourceSectionIds.map((sectionId) => sectionAliasById.get(sectionId)!)
        .filter(Boolean);
      return `[${item.memoryItemId}] ${item.kind} | ${singleLine(item.statement)} | `
        + `${item.concepts.map(singleLine).join("、")} | 章节 ${sectionAliases.join(",") || "未知"}`;
    }),
  ].join("\n");
  return { modelText, sectionIdByAlias, memoryItemIdByAlias };
}

export function buildGrantAssistantAnswerMemoryProjection(input: {
  memory: GrantDocumentMemorySnapshot;
  answerMode: GrantAssistantAnswerMode;
  targetSectionIds: string[];
  targetMemoryItemIds: string[];
}) {
  const memory = GrantDocumentMemorySnapshotSchema.parse(input.memory);
  const itemById = new Map(memory.l1.items.map((item) => [item.memoryItemId, item]));
  const selectedSectionIds = new Set(input.targetSectionIds);
  input.targetMemoryItemIds.forEach((itemId) => {
    itemById.get(itemId)?.sourceSectionIds.forEach((sectionId) => selectedSectionIds.add(sectionId));
  });

  const relatedSectionIds = descendantMemorySectionIds(memory, selectedSectionIds);
  const sections = relatedSectionIds.size > 0
    ? memory.l1.sections.filter((section) => relatedSectionIds.has(section.sectionId))
    : memory.l1.sections;
  const selectedItemIds = new Set(input.targetMemoryItemIds);
  if (relatedSectionIds.size > 0) {
    memory.l1.items.filter((item) => item.sourceSectionIds.some((sectionId) => relatedSectionIds.has(sectionId)))
      .forEach((item) => selectedItemIds.add(item.memoryItemId));
  } else if (input.answerMode === "review" || input.answerMode === "analyze") {
    memory.l1.items.forEach((item) => selectedItemIds.add(item.memoryItemId));
  } else {
    cognitionItemIds(memory, 2).forEach((itemId) => selectedItemIds.add(itemId));
  }
  const items = memory.l1.items.filter((item) => selectedItemIds.has(item.memoryItemId));
  return [
    `L0 全文认知：${singleLine(memory.l0.overview)}`,
    "L1 相关章节记忆：",
    ...sections.map((section) => `${singleLine(section.title)}（${singleLine(section.semanticRole)}）：${singleLine(section.summary)}`),
    ...(items.length > 0 ? ["L1 相关语义记忆：", ...items.map((item) =>
      `[${item.memoryItemId}] ${item.kind}：${singleLine(item.statement)}`)] : []),
  ].join("\n");
}
