import { CanonicalGrantSnapshotSchema, type CanonicalGrantSnapshot } from "../domain/contracts.ts";
import { sha256Canonical } from "../domain/canonical-json.ts";

export type GrantFullDocumentContextNode = {
  sourceAlias: string;
  nodeId: string;
  sectionAlias: string;
  nodeType: CanonicalGrantSnapshot["nodes"][number]["nodeType"];
  order: number;
  text: string;
};

export type GrantFullDocumentContextSection = {
  sectionAlias: string;
  sectionId: string;
  parentSectionAlias: string | null;
  depth: number;
  order: number;
  semanticRole: string;
  title: string;
  nodeAliases: string[];
  modelText: string;
};

export type GrantFullDocumentContext = {
  schemaVersion: "grant-full-document-context-v1";
  documentId: string;
  sourceRevisionId: string;
  title: string;
  sections: GrantFullDocumentContextSection[];
  nodes: GrantFullDocumentContextNode[];
  modelText: string;
  contextHash: string;
  coverage: {
    sectionCount: number;
    nodeCount: number;
    emptySectionCount: number;
    coveredSectionCount: number;
    coveredNodeCount: number;
    complete: true;
  };
};

function formatNodeText(node: CanonicalGrantSnapshot["nodes"][number]): string {
  switch (node.nodeType) {
    case "heading": return node.content.text;
    case "paragraph": return node.content.text;
    case "list": return node.content.items.map((item, index) =>
      `${node.content.ordered ? `${index + 1}.` : "-"} ${item}`).join("\n");
    case "table": return node.content.rows.map((row) => row.join(" | ")).join("\n");
    case "figure": return [node.content.altText, node.content.caption].filter(Boolean).join("\n");
    case "formula": return node.content.latex;
    case "citation": return "参考文献引用节点";
  }
}

export function buildGrantFullDocumentContext(input: {
  documentId: string;
  sourceRevisionId: string;
  snapshot: CanonicalGrantSnapshot;
}): GrantFullDocumentContext {
  const snapshot = CanonicalGrantSnapshotSchema.parse(input.snapshot);
  const sectionsByParent = new Map<string | null, typeof snapshot.sections>();
  for (const section of snapshot.sections) {
    const parent = section.parentSectionId ?? null;
    sectionsByParent.set(parent, [...(sectionsByParent.get(parent) ?? []), section]);
  }
  for (const siblings of sectionsByParent.values()) siblings.sort((left, right) => left.order - right.order);

  const orderedSections: Array<{ section: typeof snapshot.sections[number]; depth: number }> = [];
  const visit = (parentSectionId: string | null, depth: number) => {
    for (const section of sectionsByParent.get(parentSectionId) ?? []) {
      orderedSections.push({ section, depth });
      visit(section.sectionId, depth + 1);
    }
  };
  visit(null, 0);
  if (orderedSections.length !== snapshot.sections.length) {
    throw new Error("Full-document context did not cover every canonical section.");
  }

  const sectionAliasById = new Map(orderedSections.map(({ section }, index) => [section.sectionId, `S${index + 1}`]));
  const canonicalNodesById = new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
  const nodes: GrantFullDocumentContextNode[] = [];
  const sections: GrantFullDocumentContextSection[] = [];
  for (const { section, depth } of orderedSections) {
    const sectionAlias = sectionAliasById.get(section.sectionId)!;
    const sectionNodes = section.nodeIds.map((nodeId) => canonicalNodesById.get(nodeId)!)
      .sort((left, right) => left.order - right.order);
    const nodeAliases: string[] = [];
    for (const node of sectionNodes) {
      const sourceAlias = `D${nodes.length + 1}`;
      nodeAliases.push(sourceAlias);
      nodes.push({ sourceAlias, nodeId: node.nodeId, sectionAlias, nodeType: node.nodeType,
        order: node.order, text: formatNodeText(node) });
    }
    const sectionModelText = [`${"#".repeat(Math.min(depth + 1, 6))} [${sectionAlias}] ${section.title}`,
      ...nodeAliases.map((alias) => {
        const node = nodes.find((candidate) => candidate.sourceAlias === alias)!;
        return `[${node.sourceAlias}] (${node.nodeType})\n${node.text}`;
      })].join("\n\n");
    sections.push({ sectionAlias, sectionId: section.sectionId,
      parentSectionAlias: section.parentSectionId ? sectionAliasById.get(section.parentSectionId)! : null,
      depth, order: section.order, semanticRole: section.semanticRole, title: section.title, nodeAliases,
      modelText: sectionModelText });
  }
  if (nodes.length !== snapshot.nodes.length || new Set(nodes.map((node) => node.nodeId)).size !== snapshot.nodes.length) {
    throw new Error("Full-document context did not cover every canonical node exactly once.");
  }

  const modelText = [`申请书标题：${snapshot.title}`, ...sections.map((section) => section.modelText)].join("\n\n");
  const contextHash = sha256Canonical({ documentId: input.documentId,
    sourceRevisionId: input.sourceRevisionId, title: snapshot.title, sections, nodes });
  const emptySectionCount = sections.filter((section) => section.nodeAliases.length === 0).length;
  return Object.freeze({ schemaVersion: "grant-full-document-context-v1" as const,
    documentId: input.documentId, sourceRevisionId: input.sourceRevisionId, title: snapshot.title,
    sections, nodes, modelText, contextHash,
    coverage: { sectionCount: snapshot.sections.length, nodeCount: snapshot.nodes.length,
      emptySectionCount, coveredSectionCount: sections.length, coveredNodeCount: nodes.length, complete: true as const } });
}

