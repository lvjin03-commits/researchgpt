import path from "node:path";
import sharp from "sharp";
import type { GeneratedFigureBinary } from "./figure-pipeline";
import type { FigureLabelSpec, FigureRequest } from "./contracts";
import { createFigureLabelSpecs } from "./render-policy";

const CANVAS_WIDTH = 1800;
const BASE_RASTER_HEIGHT = 1000;
const FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSansCJKsc-Regular.otf",
);
const LABEL_RENDERER_VERSION = "figure-label-renderer-v1";
const FONT_POLICY_VERSION = "noto-cjk-v1";

type LabelLayout = {
  label: FigureLabelSpec;
  x: number;
  y: number;
  width: number;
  height: number;
};

function escapeMarkup(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function effectiveLabels(request: FigureRequest): FigureLabelSpec[] {
  return request.labels.length > 0
    ? request.labels
    : createFigureLabelSpecs({
        requestId: request.requestId,
        claimsRepresented: request.claimsRepresented,
      });
}

async function renderTextLayer(input: {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  align?: "left" | "centre" | "right";
}): Promise<Buffer> {
  return sharp({
    text: {
      text: escapeMarkup(input.text),
      font: `Noto Sans CJK SC ${input.fontSize}`,
      fontfile: FONT_PATH,
      width: input.width,
      height: input.height,
      align: input.align ?? "centre",
      rgba: true,
    },
  })
    .png()
    .toBuffer();
}

function cardLayout(labels: FigureLabelSpec[]): {
  layouts: LabelLayout[];
  height: number;
} {
  const columns = labels.length <= 3 ? Math.max(1, labels.length) : 2;
  const rows = Math.max(1, Math.ceil(labels.length / columns));
  const gap = 70;
  const marginX = 100;
  const top = 100;
  const cardHeight = 170;
  const cardWidth = Math.floor(
    (CANVAS_WIDTH - marginX * 2 - gap * (columns - 1)) / columns,
  );
  const height = Math.max(
    520,
    top + rows * cardHeight + (rows - 1) * gap + 100,
  );
  return {
    height,
    layouts: labels.map((label, index) => ({
      label,
      x: marginX + (index % columns) * (cardWidth + gap),
      y: top + Math.floor(index / columns) * (cardHeight + gap),
      width: cardWidth,
      height: cardHeight,
    })),
  };
}

function cardShapesSvg(input: {
  layouts: LabelLayout[];
  height: number;
  processFlow: boolean;
}): Buffer {
  const arrows = input.processFlow
    ? input.layouts.slice(0, -1).map((layout, index) => {
        const next = input.layouts[index + 1];
        if (!next || next.y !== layout.y) return "";
        const x1 = layout.x + layout.width;
        const x2 = next.x;
        const y = layout.y + layout.height / 2;
        return `<path d="M ${x1 + 10} ${y} H ${x2 - 22}" stroke="#345995" stroke-width="10"/><path d="M ${x2 - 42} ${y - 18} L ${x2 - 12} ${y} L ${x2 - 42} ${y + 18} Z" fill="#345995"/>`;
      })
    : [];
  const cards = input.layouts.map(
    (layout, index) =>
      `<rect x="${layout.x}" y="${layout.y}" width="${layout.width}" height="${layout.height}" rx="28" fill="${index % 2 === 0 ? "#eef4ff" : "#eef9f5"}" stroke="#263238" stroke-width="5"/>`,
  );
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${input.height}" viewBox="0 0 ${CANVAS_WIDTH} ${input.height}"><rect width="100%" height="100%" fill="#ffffff"/>${arrows.join("")}${cards.join("")}</svg>`,
    "utf8",
  );
}

export async function renderDeterministicScientificFigure(
  request: FigureRequest,
): Promise<GeneratedFigureBinary> {
  const labels = effectiveLabels(request);
  const { layouts, height } = cardLayout(labels);
  const shapes = cardShapesSvg({
    layouts,
    height,
    processFlow: request.figureType === "process_flow",
  });
  const textLayers = await Promise.all(
    layouts.map(async ({ label, x, y, width, height: labelHeight }, index) => ({
      input: await renderTextLayer({
        text: `${index + 1}. ${label.text}`,
        width: width - 60,
        height: labelHeight - 44,
        fontSize: 32,
      }),
      left: x + 30,
      top: y + 22,
    })),
  );
  const png = await sharp(shapes, { density: 300 })
    .resize({ width: CANVAS_WIDTH, height })
    .composite(textLayers)
    .png()
    .withMetadata({ density: 300 })
    .toBuffer();
  return {
    format: "png",
    data: png,
    provenance: {
      labelRendererVersion: LABEL_RENDERER_VERSION,
      fontPolicyVersion: FONT_POLICY_VERSION,
    },
  };
}

export async function overlayFigureLabels(input: {
  request: FigureRequest;
  basePng: Uint8Array;
  baseAssetProvider: string;
}): Promise<GeneratedFigureBinary> {
  const labels = effectiveLabels(input.request);
  const columns = labels.length <= 3 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(labels.length / columns));
  const legendHeight = 80 + rows * 96;
  const totalHeight = BASE_RASTER_HEIGHT + legendHeight;
  const base = await sharp(input.basePng)
    .resize({
      width: CANVAS_WIDTH,
      height: BASE_RASTER_HEIGHT,
      fit: "contain",
      background: "#ffffff",
    })
    .png()
    .toBuffer();
  const columnWidth = Math.floor((CANVAS_WIDTH - 160) / columns);
  const textLayers = await Promise.all(
    labels.map(async (label, index) => ({
      input: await renderTextLayer({
        text: `${index + 1}. ${label.text}`,
        width: columnWidth - 40,
        height: 76,
        fontSize: 28,
        align: "left",
      }),
      left: 80 + (index % columns) * columnWidth,
      top: BASE_RASTER_HEIGHT + 45 + Math.floor(index / columns) * 96,
    })),
  );
  const divider = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_WIDTH}" height="${totalHeight}"><rect width="100%" height="100%" fill="#ffffff"/><line x1="80" y1="${BASE_RASTER_HEIGHT + 12}" x2="${CANVAS_WIDTH - 80}" y2="${BASE_RASTER_HEIGHT + 12}" stroke="#c7ced8" stroke-width="3"/></svg>`,
    "utf8",
  );
  const png = await sharp(divider, { density: 300 })
    .resize({ width: CANVAS_WIDTH, height: totalHeight })
    .composite([{ input: base, left: 0, top: 0 }, ...textLayers])
    .png()
    .withMetadata({ density: 300 })
    .toBuffer();
  return {
    format: "png",
    data: png,
    provenance: {
      baseAssetProvider: input.baseAssetProvider,
      labelRendererVersion: LABEL_RENDERER_VERSION,
      fontPolicyVersion: FONT_POLICY_VERSION,
    },
  };
}
