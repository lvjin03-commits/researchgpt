import type { FinalDocumentSpec } from "../contracts";
import { deriveCitationManifest } from "../citations/manifest";
import { sha256Canonical } from "../runtime/canonical-hash";

export type CaptionManifestEntry = {
  blockId: string;
  kind: "figure" | "table";
  number: number;
  label: string;
  title: string;
  position: "above" | "below";
  keepWithObject: true;
};

export type LayoutManifestEntry = {
  blockId: string;
  order: number;
  kind: FinalDocumentSpec["blocks"][number]["type"];
  styleRole:
    | "heading_1"
    | "heading_2"
    | "heading_3"
    | "abstract"
    | "body"
    | "keywords"
    | "table"
    | "figure";
  keepWithNext: boolean;
  tableColumnWidthsDxa?: number[];
};

export type DocumentAssemblyManifest = {
  manifestVersion: "document-assembly-v1";
  sourceContentHash: string;
  orderedBlockIds: string[];
  captions: CaptionManifestEntry[];
  layout: LayoutManifestEntry[];
  citation: ReturnType<typeof deriveCitationManifest>;
};

function captionLabel(
  language: FinalDocumentSpec["metadata"]["language"],
  kind: CaptionManifestEntry["kind"],
  number: number,
): string {
  if (language === "zh") return kind === "figure" ? `图 ${number}` : `表 ${number}`;
  return kind === "figure" ? `Fig. ${number}` : `Table ${number}`;
}

function distributeTableWidth(
  columns: string[],
  rows: string[][],
  totalWidthDxa: number,
): number[] {
  const weights = columns.map((column, columnIndex) => {
    const lengths = [
      column.length * 1.25,
      ...rows.map((row) => (row[columnIndex] ?? "").length),
    ];
    const representative = lengths.sort((left, right) => left - right)[
      Math.floor(lengths.length * 0.75)
    ] ?? 1;
    return Math.max(8, Math.min(36, representative));
  });
  const minimum = Math.floor(totalWidthDxa * 0.12);
  const provisional = weights.map((weight) =>
    Math.max(minimum, Math.floor((weight / weights.reduce((sum, item) => sum + item, 0)) * totalWidthDxa)),
  );
  const provisionalTotal = provisional.reduce((sum, width) => sum + width, 0);
  const normalized = provisional.map((width) =>
    Math.floor((width / provisionalTotal) * totalWidthDxa),
  );
  normalized[normalized.length - 1] +=
    totalWidthDxa - normalized.reduce((sum, width) => sum + width, 0);
  return normalized;
}

export function assembleDocumentManifest(
  spec: FinalDocumentSpec,
  contentWidthDxa = 9_412,
): DocumentAssemblyManifest {
  let figureNumber = 0;
  let tableNumber = 0;
  const captions: CaptionManifestEntry[] = [];
  const layout = spec.blocks.map((block, order): LayoutManifestEntry => {
    if (block.type === "heading") {
      return {
        blockId: block.id,
        order,
        kind: block.type,
        styleRole: `heading_${block.level}`,
        keepWithNext: true,
      };
    }
    if (block.type === "paragraph") {
      return {
        blockId: block.id,
        order,
        kind: block.type,
        styleRole: block.role === "abstract" ? "abstract" : "body",
        keepWithNext: false,
      };
    }
    if (block.type === "keywords") {
      return {
        blockId: block.id,
        order,
        kind: block.type,
        styleRole: "keywords",
        keepWithNext: false,
      };
    }
    if (block.type === "table") {
      tableNumber += 1;
      captions.push({
        blockId: block.id,
        kind: "table",
        number: tableNumber,
        label: captionLabel(spec.metadata.language, "table", tableNumber),
        title: block.caption,
        position: spec.templateSnapshot.rules.tableCaptionPosition,
        keepWithObject: true,
      });
      return {
        blockId: block.id,
        order,
        kind: block.type,
        styleRole: "table",
        keepWithNext: false,
        tableColumnWidthsDxa: distributeTableWidth(
          block.columns,
          block.rows,
          contentWidthDxa,
        ),
      };
    }
    figureNumber += 1;
    captions.push({
      blockId: block.id,
      kind: "figure",
      number: figureNumber,
      label: captionLabel(spec.metadata.language, "figure", figureNumber),
      title: block.caption,
      position: spec.templateSnapshot.rules.figureCaptionPosition,
      keepWithObject: true,
    });
    return {
      blockId: block.id,
      order,
      kind: block.type,
      styleRole: "figure",
      keepWithNext: true,
    };
  });

  const orderedBlockIds = spec.blocks.map((block) => block.id);
  return {
    manifestVersion: "document-assembly-v1",
    sourceContentHash: sha256Canonical(
      spec.blocks.map((block) => ({ id: block.id, block })),
    ),
    orderedBlockIds,
    captions,
    layout,
    citation: deriveCitationManifest(spec),
  };
}
