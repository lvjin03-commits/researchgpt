import type { CanonicalGrantSnapshot } from "../domain/contracts.ts";

export function grantNodeText(node: CanonicalGrantSnapshot["nodes"][number]): string {
  switch (node.nodeType) {
    case "heading":
    case "paragraph":
      return node.content.text;
    case "list":
      return node.content.items.join("\n");
    case "table":
      return node.content.rows.map((row) => row.join("\t")).join("\n");
    case "figure":
      return [node.content.altText, node.content.caption].filter(Boolean).join("\n");
    case "citation":
      return node.content.referenceId;
    case "formula":
      return node.content.latex;
  }
}
