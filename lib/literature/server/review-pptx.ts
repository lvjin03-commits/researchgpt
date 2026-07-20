// Server-only module.

import pptxgen from "pptxgenjs";
import type {
  PresentationDeck,
  PresentationSlideType,
  PresentationTemplateId,
  PresentationVisualMode,
} from "@/lib/literature/review/types";

type VisualType =
  | "timeline"
  | "taxonomy"
  | "framework"
  | "comparison"
  | "insight"
  | "gap"
  | "future"
  | "summary";

type SlideContent = {
  type: PresentationSlideType;
  title: string;
  takeaway: string;
  visual: VisualType;
  visualMode: PresentationVisualMode;
  visualTitle: string;
  visualDescription: string;
  visualSource: string;
  bullets: string[];
  citations: string[];
  speakerNotes: string;
};

const SHAPE = new pptxgen().ShapeType;
const FONT_CN = "Microsoft YaHei";
const FONT_LATIN = "Aptos";
const COLORS = {
  ink: "10233F",
  muted: "5E6E82",
  blue: "1768E5",
  cyan: "22A7C7",
  green: "159A74",
  amber: "E3A21A",
  red: "D9534F",
  violet: "7857D8",
  paper: "FFFFFF",
  wash: "F4F7FB",
  line: "D8E0EA",
};
const TEAL_TEMPLATE = {
  teal: "607F89",
  tealDark: "435F68",
  pale: "EEF3F4",
  paper: "FFFFFF",
  ink: "172126",
  muted: "607078",
};

const VISUAL_TYPES = new Set<VisualType>([
  "timeline",
  "taxonomy",
  "framework",
  "comparison",
  "insight",
  "gap",
  "future",
  "summary",
]);

function stripMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function compact(value: string, max = 70): string {
  const cleaned = stripMarkdown(value).replace(/\s+/g, " ");
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

function normalizeVisual(value: string): VisualType | null {
  const normalized = value.trim().toLowerCase();
  return VISUAL_TYPES.has(normalized as VisualType)
    ? (normalized as VisualType)
    : null;
}

function inferVisual(title: string, index: number): VisualType {
  const normalized = title.toLowerCase();
  if (/timeline|脉络|演进|时间/.test(normalized)) return "timeline";
  if (/taxonomy|分类|主题|谱系/.test(normalized)) return "taxonomy";
  if (/framework|框架|机制|模型|流程/.test(normalized)) return "framework";
  if (/comparison|对比|比较|代表性/.test(normalized)) return "comparison";
  if (/gap|空白|瓶颈|不足/.test(normalized)) return "gap";
  if (/future|未来|方向|展望/.test(normalized)) return "future";
  if (/insight|洞察|发现/.test(normalized)) return "insight";
  const cycle: VisualType[] = [
    "summary",
    "timeline",
    "taxonomy",
    "framework",
    "comparison",
    "insight",
    "gap",
    "future",
  ];
  return cycle[index % cycle.length];
}

function parseSlidesFromMarkdown(content: string): SlideContent[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const chunks = normalized
    .split(/\n(?=##\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [{
      type: "summary",
      title: "学术汇报",
      takeaway: "形成可汇报的研究脉络",
      visual: "summary",
      visualMode: "none",
      visualTitle: "",
      visualDescription: "",
      visualSource: "",
      bullets: [normalized || "暂无内容"],
      citations: [],
      speakerNotes: "",
    }];
  }

  return chunks.map((chunk, index) => {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = stripMarkdown(lines[0] ?? "") || `幻灯片 ${index + 1}`;
    let takeaway = "";
    let visual: VisualType | null = null;
    const bullets: string[] = [];
    for (const rawLine of lines.slice(1)) {
      const cleaned = stripMarkdown(rawLine);
      const takeawayMatch = /^结论[:：]\s*(.+)$/.exec(cleaned);
      if (takeawayMatch) {
        takeaway = takeawayMatch[1].trim();
        continue;
      }
      const visualMatch = /^图示[:：]\s*(.+)$/.exec(cleaned);
      if (visualMatch) {
        visual = normalizeVisual(visualMatch[1]) ?? visual;
        continue;
      }
      if (cleaned) bullets.push(cleaned);
    }
    const compactBullets = bullets.slice(0, 4);
    return {
      type: visual ?? inferVisual(title, index),
      title,
      takeaway: takeaway || compactBullets[0] || "提炼核心结论",
      visual: visual ?? inferVisual(title, index),
      visualMode: "native",
      visualTitle: "建议图示",
      visualDescription: "根据本页要点生成可编辑结构图。",
      visualSource: "",
      bullets: compactBullets.length > 0 ? compactBullets : ["围绕该主题组织证据链"],
      citations: [],
      speakerNotes: "",
    };
  });
}

function parseSlidesFromContent(content: string): SlideContent[] {
  try {
    const deck = JSON.parse(content) as PresentationDeck;
    if (deck.schemaVersion === 1 && Array.isArray(deck.slides)) {
      return deck.slides.map((slide, index) => ({
        type: slide.type,
        title: slide.title,
        takeaway: slide.takeaway,
        visual: normalizeVisual(slide.visual.type) ?? normalizeVisual(slide.type) ?? inferVisual(slide.title, index),
        visualMode: slide.visual.mode,
        visualTitle: slide.visual.title,
        visualDescription: slide.visual.description,
        visualSource: slide.visual.source,
        bullets: slide.bullets.slice(0, 4),
        citations: slide.citations.slice(0, 5),
        speakerNotes: slide.speakerNotes,
      }));
    }
  } catch {
    // Older saved projects may still contain Markdown PPT outlines.
  }
  return parseSlidesFromMarkdown(content);
}

function addTopRule(slide: pptxgen.Slide, accent = COLORS.blue) {
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.09,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
}

function addHeader(slide: pptxgen.Slide, content: SlideContent, accent = COLORS.blue) {
  addTopRule(slide, accent);
  slide.addText(content.title, {
    x: 0.72,
    y: 0.35,
    w: 11.85,
    h: 0.64,
    fontFace: FONT_CN,
    fontSize: 35,
    bold: true,
    color: COLORS.ink,
    margin: 0,
    fit: "shrink",
  });
  slide.addShape(SHAPE.line, {
    x: 0.72,
    y: 1.18,
    w: 0.55,
    h: 0,
    line: { color: accent, width: 4 },
  });
  slide.addText(content.takeaway, {
    x: 1.42,
    y: 1.02,
    w: 10.95,
    h: 0.42,
    fontFace: FONT_CN,
    fontSize: 18,
    bold: true,
    color: accent,
    margin: 0,
    fit: "shrink",
  });
}

function addFooter(slide: pptxgen.Slide, page: number, citations: string[]) {
  slide.addShape(SHAPE.line, {
    x: 0.72,
    y: 6.93,
    w: 11.88,
    h: 0,
    line: { color: COLORS.line, width: 0.8 },
  });
  if (citations.length > 0) {
    slide.addText(`来源  ${citations.join(" · ")}`, {
      x: 0.72,
      y: 7.02,
      w: 10.7,
      h: 0.24,
      fontFace: FONT_CN,
      fontSize: 8,
      color: COLORS.muted,
      margin: 0,
      fit: "shrink",
    });
  }
  slide.addText(String(page).padStart(2, "0"), {
    x: 11.78,
    y: 6.99,
    w: 0.82,
    h: 0.26,
    fontFace: FONT_LATIN,
    fontSize: 10,
    bold: true,
    color: COLORS.muted,
    align: "right",
    margin: 0,
  });
}

function addCoverSlide(slide: pptxgen.Slide, content: SlideContent, deckTitle: string) {
  slide.background = { color: COLORS.ink };
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 7.5,
    line: { color: COLORS.cyan, transparency: 100 },
    fill: { color: COLORS.cyan },
  });
  slide.addText("RESEARCH BRIEF", {
    x: 0.92,
    y: 0.78,
    w: 4.4,
    h: 0.3,
    fontFace: FONT_LATIN,
    fontSize: 11,
    bold: true,
    charSpacing: 2.4,
    color: "83D6E6",
    margin: 0,
  });
  slide.addText(deckTitle || content.title, {
    x: 0.9,
    y: 1.48,
    w: 10.9,
    h: 1.72,
    fontFace: FONT_CN,
    fontSize: 50,
    bold: true,
    color: COLORS.paper,
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
  slide.addText(content.takeaway, {
    x: 0.94,
    y: 3.58,
    w: 9.6,
    h: 0.72,
    fontFace: FONT_CN,
    fontSize: 22,
    color: "CFE5F4",
    margin: 0,
    fit: "shrink",
  });
  slide.addShape(SHAPE.line, {
    x: 0.94,
    y: 5.72,
    w: 3.0,
    h: 0,
    line: { color: COLORS.cyan, width: 3 },
  });
  slide.addText("证据驱动 · 结构清晰 · 可编辑", {
    x: 0.94,
    y: 5.92,
    w: 4.6,
    h: 0.4,
    fontFace: FONT_CN,
    fontSize: 13,
    color: "91A7BE",
    margin: 0,
  });
}

function addTealMinimalCoverSlide(
  slide: pptxgen.Slide,
  content: SlideContent,
  deckTitle: string,
) {
  slide.background = { color: TEAL_TEMPLATE.teal };
  slide.addShape(SHAPE.rect, {
    x: 0.48,
    y: 0.48,
    w: 12.37,
    h: 6.54,
    line: { color: TEAL_TEMPLATE.paper, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.paper },
  });
  slide.addText("ACADEMIC  PRESENTATION", {
    x: 1.55,
    y: 1.62,
    w: 10.25,
    h: 0.35,
    fontFace: FONT_LATIN,
    fontSize: 13,
    charSpacing: 5,
    color: TEAL_TEMPLATE.ink,
    align: "center",
    margin: 0,
  });
  slide.addText(compact(content.title || deckTitle, 42), {
    x: 1.35,
    y: 2.18,
    w: 10.65,
    h: 1.2,
    fontFace: FONT_CN,
    fontSize: 38,
    bold: true,
    color: TEAL_TEMPLATE.ink,
    align: "center",
    valign: "middle",
    margin: 0,
    fit: "shrink",
  });
  slide.addText(compact(content.takeaway || "结构清晰的学术汇报", 82), {
    x: 2.0,
    y: 3.55,
    w: 9.33,
    h: 0.65,
    fontFace: FONT_CN,
    fontSize: 15,
    italic: true,
    color: TEAL_TEMPLATE.muted,
    align: "center",
    valign: "middle",
    margin: 0,
    fit: "shrink",
  });
  slide.addShape(SHAPE.rect, {
    x: 2.05,
    y: 4.38,
    w: 9.23,
    h: 0.5,
    line: { color: TEAL_TEMPLATE.teal, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.teal },
  });
  slide.addText("RESEARCHAI · 学术汇报", {
    x: 2.05,
    y: 4.48,
    w: 9.23,
    h: 0.26,
    fontFace: FONT_CN,
    fontSize: 12,
    color: TEAL_TEMPLATE.paper,
    align: "center",
    charSpacing: 2,
    margin: 0,
  });
}

function addTealMinimalSectionSlide(
  slide: pptxgen.Slide,
  content: SlideContent,
  page: number,
) {
  slide.background = { color: TEAL_TEMPLATE.teal };
  slide.addText(String(page).padStart(2, "0"), {
    x: 0.85,
    y: 0.55,
    w: 3.3,
    h: 2.2,
    fontFace: FONT_LATIN,
    fontSize: 112,
    bold: true,
    color: TEAL_TEMPLATE.paper,
    transparency: 12,
    margin: 0,
  });
  slide.addShape(SHAPE.line, {
    x: 1.05,
    y: 3.05,
    w: 1.15,
    h: 0,
    line: { color: TEAL_TEMPLATE.paper, width: 3 },
  });
  slide.addText(content.title, {
    x: 1.05,
    y: 3.34,
    w: 10.9,
    h: 1.15,
    fontFace: FONT_CN,
    fontSize: 38,
    bold: true,
    color: TEAL_TEMPLATE.paper,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(content.takeaway, {
    x: 1.08,
    y: 4.72,
    w: 9.7,
    h: 0.75,
    fontFace: FONT_CN,
    fontSize: 18,
    color: TEAL_TEMPLATE.pale,
    margin: 0,
    fit: "shrink",
  });
}

function addTealMinimalFrame(slide: pptxgen.Slide) {
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    line: { color: TEAL_TEMPLATE.teal, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.teal },
  });
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 7.38,
    w: 13.333,
    h: 0.12,
    line: { color: TEAL_TEMPLATE.teal, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.teal },
  });
  slide.addShape(SHAPE.rect, {
    x: 0,
    y: 0,
    w: 0.12,
    h: 7.5,
    line: { color: TEAL_TEMPLATE.teal, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.teal },
  });
  slide.addShape(SHAPE.rect, {
    x: 13.213,
    y: 0,
    w: 0.12,
    h: 7.5,
    line: { color: TEAL_TEMPLATE.teal, transparency: 100 },
    fill: { color: TEAL_TEMPLATE.teal },
  });
}

function addSectionSlide(slide: pptxgen.Slide, content: SlideContent, page: number) {
  slide.background = { color: COLORS.wash };
  slide.addText(String(page - 1).padStart(2, "0"), {
    x: 0.75,
    y: 0.68,
    w: 2.1,
    h: 1.2,
    fontFace: FONT_LATIN,
    fontSize: 58,
    bold: true,
    color: "B9C7D7",
    margin: 0,
  });
  slide.addShape(SHAPE.line, {
    x: 0.8,
    y: 2.03,
    w: 1.2,
    h: 0,
    line: { color: COLORS.blue, width: 5 },
  });
  slide.addText(content.title, {
    x: 3.1,
    y: 1.55,
    w: 8.8,
    h: 1.05,
    fontFace: FONT_CN,
    fontSize: 38,
    bold: true,
    color: COLORS.ink,
    margin: 0,
    fit: "shrink",
  });
  slide.addText(content.takeaway, {
    x: 3.14,
    y: 2.86,
    w: 7.7,
    h: 0.75,
    fontFace: FONT_CN,
    fontSize: 20,
    color: COLORS.muted,
    margin: 0,
    fit: "shrink",
  });
}

function addTimeline(slide: pptxgen.Slide, content: SlideContent) {
  addHeader(slide, content, COLORS.cyan);
  const items = content.bullets.slice(0, 4);
  slide.addShape(SHAPE.line, {
    x: 1.2,
    y: 3.65,
    w: 10.8,
    h: 0,
    line: { color: "9FD7E2", width: 3 },
  });
  items.forEach((item, index) => {
    const x = 1.15 + index * 3.05;
    const above = index % 2 === 0;
    slide.addShape(SHAPE.ellipse, {
      x,
      y: 3.47,
      w: 0.36,
      h: 0.36,
      line: { color: COLORS.cyan, width: 2 },
      fill: { color: COLORS.paper },
    });
    slide.addText(String(index + 1).padStart(2, "0"), {
      x: x - 0.04,
      y: above ? 2.35 : 4.12,
      w: 0.55,
      h: 0.3,
      fontFace: FONT_LATIN,
      fontSize: 11,
      bold: true,
      color: COLORS.cyan,
      margin: 0,
    });
    slide.addText(compact(item, 54), {
      x: x - 0.04,
      y: above ? 2.65 : 4.42,
      w: 2.55,
      h: 0.86,
      fontFace: FONT_CN,
      fontSize: 15,
      bold: true,
      color: COLORS.ink,
      margin: 0,
      fit: "shrink",
    });
  });
}

function addTaxonomy(slide: pptxgen.Slide, content: SlideContent) {
  addHeader(slide, content, COLORS.green);
  const items = content.bullets.slice(0, 4);
  slide.addText("分类框架", {
    x: 0.78,
    y: 1.85,
    w: 1.3,
    h: 0.35,
    fontFace: FONT_CN,
    fontSize: 13,
    bold: true,
    color: COLORS.green,
    margin: 0,
  });
  items.forEach((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 0.82 + col * 6.15;
    const y = 2.35 + row * 1.9;
    slide.addText(String(index + 1).padStart(2, "0"), {
      x,
      y,
      w: 0.58,
      h: 0.38,
      fontFace: FONT_LATIN,
      fontSize: 12,
      bold: true,
      color: COLORS.green,
      margin: 0,
    });
    slide.addShape(SHAPE.line, {
      x,
      y: y + 0.53,
      w: 5.35,
      h: 0,
      line: { color: index % 2 === 0 ? "8BCBB8" : "A7D8CA", width: 2 },
    });
    slide.addText(compact(item, 72), {
      x: x + 0.78,
      y: y - 0.03,
      w: 4.65,
      h: 1.16,
      fontFace: FONT_CN,
      fontSize: 18,
      bold: true,
      color: COLORS.ink,
      margin: 0,
      fit: "shrink",
    });
  });
}

function addFramework(slide: pptxgen.Slide, content: SlideContent) {
  addHeader(slide, content, COLORS.violet);
  const labels = content.bullets.slice(0, 4);
  labels.forEach((label, index) => {
    const x = 0.78 + index * 3.08;
    if (index < labels.length - 1) {
      slide.addShape(SHAPE.chevron, {
        x: x + 2.5,
        y: 3.02,
        w: 0.42,
        h: 0.72,
        line: { color: "C7B9EF", transparency: 100 },
        fill: { color: "C7B9EF" },
      });
    }
    slide.addText(String(index + 1), {
      x,
      y: 2.12,
      w: 0.45,
      h: 0.32,
      fontFace: FONT_LATIN,
      fontSize: 12,
      bold: true,
      color: COLORS.violet,
      margin: 0,
    });
    slide.addText(compact(label, 58), {
      x,
      y: 2.62,
      w: 2.42,
      h: 1.55,
      fontFace: FONT_CN,
      fontSize: 17,
      bold: true,
      color: COLORS.ink,
      fill: { color: index % 2 === 0 ? "F4F1FC" : "F9F7FE" },
      line: { color: "D8D0EE", width: 1 },
      margin: 0.16,
      valign: "middle",
      fit: "shrink",
    });
  });
  slide.addText("从输入条件到结果判断的完整证据链", {
    x: 0.82,
    y: 5.05,
    w: 11.7,
    h: 0.48,
    fontFace: FONT_CN,
    fontSize: 17,
    color: COLORS.muted,
    align: "center",
    margin: 0,
  });
}

function addComparison(slide: pptxgen.Slide, content: SlideContent) {
  addHeader(slide, content, COLORS.blue);
  const items = content.bullets.slice(0, 4);
  const midpoint = Math.ceil(items.length / 2);
  const columns = [items.slice(0, midpoint), items.slice(midpoint)];
  ["路径 A", "路径 B"].forEach((label, col) => {
    const x = 0.82 + col * 6.15;
    slide.addText(label, {
      x,
      y: 1.88,
      w: 5.55,
      h: 0.42,
      fontFace: FONT_CN,
      fontSize: 15,
      bold: true,
      color: col === 0 ? COLORS.blue : COLORS.green,
      margin: 0,
    });
    slide.addShape(SHAPE.line, {
      x,
      y: 2.38,
      w: 5.55,
      h: 0,
      line: { color: col === 0 ? "9EC1F5" : "9DD5C4", width: 2 },
    });
    columns[col].forEach((item, row) => {
      slide.addText(compact(item, 88), {
        x,
        y: 2.72 + row * 1.55,
        w: 5.25,
        h: 1.0,
        fontFace: FONT_CN,
        fontSize: 17,
        bold: true,
        color: COLORS.ink,
        margin: 0,
        fit: "shrink",
      });
    });
  });
  slide.addShape(SHAPE.line, {
    x: 6.66,
    y: 1.88,
    w: 0,
    h: 3.95,
    line: { color: COLORS.line, width: 1 },
  });
}

function addStatementSlide(slide: pptxgen.Slide, content: SlideContent, type: VisualType) {
  const accent = type === "gap" ? COLORS.red : type === "future" ? COLORS.green : type === "summary" ? COLORS.violet : COLORS.amber;
  addHeader(slide, content, accent);
  slide.addText("核心判断", {
    x: 0.8,
    y: 1.92,
    w: 1.5,
    h: 0.35,
    fontFace: FONT_CN,
    fontSize: 13,
    bold: true,
    color: accent,
    margin: 0,
  });
  slide.addText(compact(content.bullets[0] ?? content.takeaway, 110), {
    x: 0.8,
    y: 2.42,
    w: 11.1,
    h: 1.42,
    fontFace: FONT_CN,
    fontSize: 28,
    bold: true,
    color: COLORS.ink,
    margin: 0,
    fit: "shrink",
  });
  content.bullets.slice(1, 4).forEach((item, index) => {
    const x = 0.82 + index * 4.05;
    slide.addText(String(index + 1).padStart(2, "0"), {
      x,
      y: 4.52,
      w: 0.5,
      h: 0.3,
      fontFace: FONT_LATIN,
      fontSize: 11,
      bold: true,
      color: accent,
      margin: 0,
    });
    slide.addText(compact(item, 58), {
      x,
      y: 4.92,
      w: 3.52,
      h: 1.02,
      fontFace: FONT_CN,
      fontSize: 15,
      color: COLORS.ink,
      margin: 0,
      fit: "shrink",
    });
  });
}

function addEvidenceSlide(slide: pptxgen.Slide, content: SlideContent) {
  addHeader(slide, content, COLORS.blue);
  slide.addShape(SHAPE.rect, {
    x: 0.82,
    y: 1.88,
    w: 7.05,
    h: 4.55,
    line: { color: "AFC7E8", width: 1.2, dashType: "dash" },
    fill: { color: "F5F8FC" },
  });
  slide.addText("图片 / 原文图表位置", {
    x: 1.18,
    y: 2.48,
    w: 6.32,
    h: 0.45,
    fontFace: FONT_CN,
    fontSize: 18,
    bold: true,
    color: COLORS.blue,
    align: "center",
    margin: 0,
  });
  slide.addText(compact(content.visualTitle || "本页证据图", 80), {
    x: 1.2,
    y: 3.15,
    w: 6.28,
    h: 0.65,
    fontFace: FONT_CN,
    fontSize: 16,
    bold: true,
    color: COLORS.ink,
    align: "center",
    margin: 0,
    fit: "shrink",
  });
  slide.addText(compact(content.visualDescription || "请插入与本页结论直接相关的原文图表。", 150), {
    x: 1.38,
    y: 4.08,
    w: 5.92,
    h: 1.12,
    fontFace: FONT_CN,
    fontSize: 13,
    color: COLORS.muted,
    align: "center",
    margin: 0,
    fit: "shrink",
  });
  content.bullets.slice(0, 3).forEach((item, index) => {
    slide.addText(compact(item, 64), {
      x: 8.38,
      y: 2.0 + index * 1.38,
      w: 4.08,
      h: 0.92,
      fontFace: FONT_CN,
      fontSize: 16,
      bold: true,
      color: COLORS.ink,
      margin: 0,
      fit: "shrink",
      bullet: { type: "bullet" },
    });
  });
  if (content.visualSource) {
    slide.addText(`建议来源：${compact(content.visualSource, 90)}`, {
      x: 8.38,
      y: 6.0,
      w: 4.05,
      h: 0.3,
      fontFace: FONT_CN,
      fontSize: 9,
      color: COLORS.muted,
      margin: 0,
      fit: "shrink",
    });
  }
}

function renderContentSlide(slide: pptxgen.Slide, content: SlideContent) {
  if (content.visualMode === "placeholder" || content.visualMode === "evidence") {
    addEvidenceSlide(slide, content);
    return;
  }
  switch (content.visual) {
    case "timeline":
      addTimeline(slide, content);
      return;
    case "taxonomy":
      addTaxonomy(slide, content);
      return;
    case "framework":
      addFramework(slide, content);
      return;
    case "comparison":
      addComparison(slide, content);
      return;
    default:
      addStatementSlide(slide, content, content.visual);
  }
}

export async function generateReviewPptxBuffer(
  title: string,
  outlineMarkdown: string,
  templateId: PresentationTemplateId = "research-modern",
): Promise<Buffer> {
  const slides = parseSlidesFromContent(outlineMarkdown);
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ResearchGPT";
  pptx.company = "ResearchGPT";
  pptx.subject = title;
  pptx.title = title;
  pptx.theme = { headFontFace: FONT_CN, bodyFontFace: FONT_CN };

  slides.forEach((content, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.paper };
    if (content.type === "cover") {
      if (templateId === "teal-minimal") {
        addTealMinimalCoverSlide(slide, content, title);
      } else {
        addCoverSlide(slide, content, title);
      }
    } else if (content.type === "section") {
      if (templateId === "teal-minimal") {
        addTealMinimalSectionSlide(slide, content, index + 1);
      } else {
        addSectionSlide(slide, content, index + 1);
      }
    } else {
      renderContentSlide(slide, content);
      addFooter(slide, index + 1, content.citations);
      if (templateId === "teal-minimal") addTealMinimalFrame(slide);
    }
    if (content.speakerNotes) slide.addNotes(content.speakerNotes);
  });

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}
