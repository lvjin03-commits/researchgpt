import type { ArtifactTemplateId } from "@/lib/export/artifact-planner";
import { buildArtifactSpec } from "@/lib/export/artifact-spec";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function compact(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum - 1)}…`
    : normalized;
}

function wrap(value: string, maximum = 24): string[] {
  const normalized = compact(value, maximum * 3);
  const lines: string[] = [];
  for (let index = 0; index < normalized.length; index += maximum) {
    lines.push(normalized.slice(index, index + maximum));
  }
  return lines.slice(0, 3);
}

function getPalette(templateId: ArtifactTemplateId) {
  if (templateId === "modern") {
    return {
      accent: "#0f766e",
      background: "#f1f5f4",
      card: "#ffffff",
      label: "MODERN RESEARCH",
      bars: ["#0f766e", "#0891b2", "#2563eb", "#7c3aed", "#d97706", "#dc2626"],
    };
  }
  if (templateId === "minimal") {
    return {
      accent: "#475569",
      background: "#ffffff",
      card: "#f8fafc",
      label: "CONCISE REPORT",
      bars: ["#475569", "#64748b", "#334155", "#94a3b8", "#1e293b", "#64748b"],
    };
  }
  return {
    accent: "#1768e5",
    background: "#f8fafc",
    card: "#ffffff",
    label: "SCIENTIFIC ARTIFACT",
    bars: ["#2563eb", "#0f766e", "#d97706", "#7c3aed", "#0891b2", "#dc2626"],
  };
}

export function generateArtifactSvg(
  title: string,
  content: string,
  templateId: ArtifactTemplateId = "academic",
): string {
  const artifact = buildArtifactSpec(title, content);
  const palette = getPalette(templateId);
  const cards = [
    ...artifact.sections.map((section) => ({
      title: section.title,
      lines: [
        ...section.paragraphs,
        ...section.bullets.map((item) => `• ${item}`),
      ],
    })),
    ...artifact.tables.map((table) => ({
      title: table.title,
      lines: [
        `字段：${table.headers.join("、")}`,
        `共 ${table.rows.length} 条记录`,
      ],
    })),
  ]
    .filter((card) => card.lines.length > 0)
    .slice(0, 6);
  const width = 1600;
  const height = 900;
  const cardWidth = 450;
  const cardHeight = 220;
  const startX = 92;
  const startY = 300;
  const gapX = 42;
  const gapY = 38;

  const cardMarkup = cards
    .map((card, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = startX + column * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);
      const lines = card.lines
        .slice(0, 4)
        .flatMap((line) => wrap(line, 24))
        .slice(0, 6);

      return `
        <g>
          <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="10" fill="${palette.card}" stroke="#cbd5e1" stroke-width="2"/>
          <rect x="${x}" y="${y}" width="8" height="${cardHeight}" rx="4" fill="${palette.bars[index]}"/>
          <text x="${x + 28}" y="${y + 42}" class="card-title">${escapeXml(compact(card.title, 28))}</text>
          ${lines
            .map(
              (line, lineIndex) =>
                `<text x="${x + 28}" y="${y + 82 + lineIndex * 22}" class="body">${escapeXml(line)}</text>`,
            )
            .join("")}
        </g>`;
    })
    .join("");

  const summaryLines = wrap(artifact.summary, 54);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: "Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif; }
    .eyebrow { font-size: 22px; font-weight: 700; fill: ${palette.accent}; }
    .title { font-size: 46px; font-weight: 800; fill: #0f172a; }
    .summary { font-size: 23px; font-weight: 500; fill: #475569; }
    .card-title { font-size: 23px; font-weight: 700; fill: #0f172a; }
    .body { font-size: 18px; font-weight: 400; fill: #334155; }
  </style>
  <rect width="${width}" height="${height}" fill="${palette.background}"/>
  <rect x="0" y="0" width="${width}" height="16" fill="${palette.accent}"/>
  <text x="92" y="78" class="eyebrow">RESEARCHAI · ${palette.label}</text>
  <text x="92" y="148" class="title">${escapeXml(compact(artifact.title, 44))}</text>
  ${summaryLines
    .map(
      (line, index) =>
        `<text x="92" y="${205 + index * 31}" class="summary">${escapeXml(line)}</text>`,
    )
    .join("")}
  ${cardMarkup}
  <text x="92" y="860" class="body">本图根据当前回答自动整理；正式使用前请核对数据、来源与引用。</text>
</svg>`;
}

export function generateArtifactSvgBuffer(
  title: string,
  content: string,
  templateId: ArtifactTemplateId = "academic",
): Buffer {
  return Buffer.from(generateArtifactSvg(title, content, templateId), "utf8");
}
