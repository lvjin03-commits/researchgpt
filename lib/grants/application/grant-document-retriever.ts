import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";

export type GrantDocumentSearchBlock = {
  blockId: string;
  sectionId: string;
  nodeId: string | null;
  title: string;
  text: string;
  sourceRevisionId: string;
  order: number;
};

export type GrantDocumentSearchResult = GrantDocumentSearchBlock & { score: number };

const CJK = /[\u3400-\u9fff]/u;

function terms(value: string): string[] {
  const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, " ");
  const words = normalized.split(/\s+/u).filter((word) => word.length > 1);
  const cjk = [...normalized].filter((character) => CJK.test(character));
  return [...new Set([...words, ...cjk])];
}

function nodeText(node: CanonicalGrantSnapshot["nodes"][number]): string {
  switch (node.nodeType) {
    case "heading":
    case "paragraph":
      return node.content.text;
    case "list":
      return node.content.items.join("\n");
    case "table":
      return node.content.rows.map((row) => row.join(" | ")).join("\n");
    case "figure":
      return [node.content.altText, node.content.caption].filter(Boolean).join("\n");
    case "formula":
      return node.content.latex;
    case "citation":
      return `引用 ${node.content.referenceId}`;
  }
}

export function buildGrantDocumentSearchBlocks(
  snapshot: CanonicalGrantSnapshot,
  sourceRevisionId: string,
): GrantDocumentSearchBlock[] {
  const sections = new Map(snapshot.sections.map((section) => [section.sectionId, section]));
  const blocks = snapshot.nodes
    .map((node) => {
      const section = sections.get(node.sectionId);
      const text = nodeText(node).trim();
      if (!section || !text) return null;
      return {
        blockId: `${sourceRevisionId}:${node.nodeId}`,
        sectionId: section.sectionId,
        nodeId: node.nodeId,
        title: section.title,
        text,
        sourceRevisionId,
        order: section.order * 100000 + node.order,
      } satisfies GrantDocumentSearchBlock;
    })
    .filter((block) => block !== null);
  return blocks
    .sort((left, right) => left.order - right.order);
}

export function retrieveGrantDocumentBlocks(input: {
  snapshot: CanonicalGrantSnapshot;
  sourceRevisionId: string;
  query: string;
  limit?: number;
  blocks?: GrantDocumentSearchBlock[];
}): GrantDocumentSearchResult[] {
  const queryTerms = terms(input.query);
  if (queryTerms.length === 0) return [];
  const blocks = input.blocks ?? buildGrantDocumentSearchBlocks(input.snapshot, input.sourceRevisionId);
  return blocks
    .map((block) => {
      const titleTerms = terms(block.title);
      const textTerms = terms(block.text);
      const titleHits = queryTerms.filter((term) => titleTerms.includes(term)).length;
      const textHits = queryTerms.filter((term) => textTerms.includes(term)).length;
      const score = titleHits * 3 + textHits;
      return { ...block, score };
    })
    .filter((block) => block.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, input.limit ?? 6);
}
