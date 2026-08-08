import {
  GrantLengthEstimateSchema,
  type CanonicalGrantSnapshot,
  type GrantLengthEstimate,
} from "../domain/contracts.ts";

const DEFAULT_CHARACTERS_PER_PAGE = 1100;

function textFromSnapshot(snapshot: CanonicalGrantSnapshot): string {
  const pieces = [snapshot.title, ...snapshot.sections.map((section) => section.title)];
  for (const node of snapshot.nodes) {
    switch (node.nodeType) {
      case "heading":
      case "paragraph":
        pieces.push(node.content.text);
        break;
      case "list":
        pieces.push(...node.content.items);
        break;
      case "table":
        pieces.push(...node.content.rows.flat());
        break;
      case "figure":
        pieces.push(node.content.altText, node.content.caption ?? "");
        break;
      case "formula":
        pieces.push(node.content.latex);
        break;
      case "citation":
        break;
    }
  }
  return pieces.join("\n");
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function estimateGrantLength(
  snapshot: CanonicalGrantSnapshot,
  templateRules: Record<string, unknown>,
): GrantLengthEstimate {
  const text = textFromSnapshot(snapshot);
  const visibleCharacters = Array.from(text.replace(/\s/gu, "")).length;
  const hanCharacters = text.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g)?.length ?? 0;
  const charactersPerPage = positiveInteger(templateRules.charactersPerPage) ?? DEFAULT_CHARACTERS_PER_PAGE;
  const maximumEstimatedPages = positiveInteger(templateRules.maximumEstimatedPages);
  const estimatedPages = visibleCharacters === 0 ? 0 : Math.ceil(visibleCharacters / charactersPerPage);
  return GrantLengthEstimateSchema.parse({
    visibleCharacters,
    hanCharacters,
    latinWords,
    estimatedPages,
    charactersPerPage,
    maximumEstimatedPages,
    exceedsEstimatedLimit: maximumEstimatedPages !== undefined && estimatedPages > maximumEstimatedPages,
  });
}
