// Server-only module.

import pptxgen from "pptxgenjs";

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
  title: string;
  takeaway: string;
  visual: VisualType;
  bullets: string[];
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
    return [
      {
        title: "学术汇报",
        takeaway: "形成可汇报的研究脉络",
        visual: "summary",
        bullets: [normalized || "暂无内容"],
      },
    ];
  }

  return chunks.map((chunk, index) => {
    const rawLines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = stripMarkdown(rawLines[0] ?? "") || `幻灯片 ${index + 1}`;
    let takeaway = "";
    let visual: VisualType | null = null;
    const bullets: string[] = [];

    for (const rawLine of rawLines.slice(1)) {
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

      if (cleaned) {
        bullets.push(cleaned);
      }
    }

    const compactBullets = bullets.slice(0, 4);
    return {
      title,
      takeaway: takeaway || compactBullets[0] || "提炼核心结论",
      visual: visual ?? inferVisual(title, index),
      bullets:
        compactBullets.length > 0 ? compactBullets : ["围绕该主题组织证据链"],
    };
  });
}

function addHeader(slide: pptxgen.Slide, slideContent: SlideContent) {
  slide.addText(slideContent.title, {
    x: 0.55,
    y: 0.28,
    w: 8.8,
    h: 0.42,
    fontFace: "Microsoft YaHei",
    fontSize: 21,
    bold: true,
    color: "0F172A",
    margin: 0,
    fit: "shrink",
  });

  slide.addText(slideContent.takeaway, {
    x: 0.55,
    y: 0.83,
    w: 12.2,
    h: 0.46,
    fontFace: "Microsoft YaHei",
    fontSize: 15,
    bold: true,
    color: "1D4ED8",
    fill: { color: "EFF6FF" },
    line: { color: "BFDBFE", width: 1 },
    margin: 0.1,
    fit: "shrink",
  });
}

function addFooter(slide: pptxgen.Slide, pageNumber: number) {
  slide.addText(`ResearchAI · ${pageNumber}`, {
    x: 0.55,
    y: 7.03,
    w: 12.2,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 8,
    color: "64748B",
    align: "right",
    margin: 0,
  });
}

function addVisualLabel(
  slide: pptxgen.Slide,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "F8FAFC",
) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: "Microsoft YaHei",
    fontSize: 10,
    bold: true,
    color: "0F172A",
    fill: { color: fill },
    line: { color: "CBD5E1", width: 1 },
    align: "center",
    valign: "middle",
    margin: 0.06,
    fit: "shrink",
  });
}

function addVisualTitle(slide: pptxgen.Slide, label: string) {
  slide.addText(label, {
    x: 0.65,
    y: 1.52,
    w: 5.45,
    h: 0.25,
    fontFace: "Aptos",
    fontSize: 8,
    bold: true,
    color: "64748B",
    margin: 0,
  });
}

function addTimeline(slide: pptxgen.Slide, bullets: string[]) {
  addVisualTitle(slide, "TIMELINE");
  const items = bullets.slice(0, 4);
  items.forEach((item, index) => {
    addVisualLabel(
      slide,
      `${index + 1}\n${item}`,
      0.72 + index * 1.35,
      2.35,
      1.1,
      1.15,
      index % 2 === 0 ? "DBEAFE" : "E0F2FE",
    );
  });
  slide.addText("evidence flow", {
    x: 0.85,
    y: 3.75,
    w: 4.8,
    h: 0.25,
    fontSize: 9,
    color: "64748B",
    align: "center",
    margin: 0,
  });
}

function addTaxonomy(slide: pptxgen.Slide, bullets: string[]) {
  addVisualTitle(slide, "TAXONOMY");
  const items = bullets.slice(0, 4);
  items.forEach((item, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    addVisualLabel(
      slide,
      item,
      0.8 + col * 2.55,
      2.0 + row * 1.35,
      2.25,
      0.95,
      ["ECFDF5", "EFF6FF", "F5F3FF", "FFFBEB"][index] ?? "F8FAFC",
    );
  });
}

function addFramework(slide: pptxgen.Slide, bullets: string[]) {
  addVisualTitle(slide, "FRAMEWORK");
  const labels = [
    bullets[0] ?? "Input",
    bullets[1] ?? "Mechanism",
    bullets[2] ?? "Outcome",
  ];
  labels.forEach((label, index) => {
    addVisualLabel(
      slide,
      label,
      0.78 + index * 1.7,
      2.35,
      1.35,
      1.05,
      ["E0F2FE", "DBEAFE", "DCFCE7"][index],
    );
  });
  slide.addText("→        →", {
    x: 1.9,
    y: 2.64,
    w: 3.2,
    h: 0.3,
    fontSize: 20,
    bold: true,
    color: "2563EB",
    align: "center",
    margin: 0,
  });
}

function addComparison(slide: pptxgen.Slide, bullets: string[]) {
  addVisualTitle(slide, "COMPARISON");
  addVisualLabel(slide, "研究对象", 0.75, 1.95, 1.45, 0.55, "EFF6FF");
  addVisualLabel(slide, "方法", 2.2, 1.95, 1.45, 0.55, "EFF6FF");
  addVisualLabel(slide, "局限", 3.65, 1.95, 1.45, 0.55, "EFF6FF");
  bullets.slice(0, 3).forEach((item, index) => {
    addVisualLabel(slide, item, 0.75, 2.62 + index * 0.7, 4.35, 0.48, "FFFFFF");
  });
}

function addInsight(slide: pptxgen.Slide, bullets: string[], type: VisualType) {
  const label = type.toUpperCase();
  const colors: Record<VisualType, string> = {
    timeline: "DBEAFE",
    taxonomy: "ECFDF5",
    framework: "E0F2FE",
    comparison: "F8FAFC",
    insight: "FEF3C7",
    gap: "FEE2E2",
    future: "DCFCE7",
    summary: "EDE9FE",
  };
  addVisualTitle(slide, label);
  addVisualLabel(slide, label, 1.35, 2.05, 3.65, 0.7, colors[type]);
  addVisualLabel(slide, bullets[0] ?? "核心判断", 1.0, 3.02, 4.35, 0.72, "FFFFFF");
  addVisualLabel(slide, bullets[1] ?? "证据链", 1.0, 3.9, 4.35, 0.72, "FFFFFF");
}

function addVisual(slide: pptxgen.Slide, slideContent: SlideContent) {
  slide.addText("", {
    x: 0.55,
    y: 1.42,
    w: 5.9,
    h: 5.35,
    fill: { color: "F8FAFC" },
    line: { color: "E2E8F0", width: 1 },
    margin: 0,
  });

  switch (slideContent.visual) {
    case "timeline":
      addTimeline(slide, slideContent.bullets);
      break;
    case "taxonomy":
      addTaxonomy(slide, slideContent.bullets);
      break;
    case "framework":
      addFramework(slide, slideContent.bullets);
      break;
    case "comparison":
      addComparison(slide, slideContent.bullets);
      break;
    default:
      addInsight(slide, slideContent.bullets, slideContent.visual);
      break;
  }
}

function addBulletCards(slide: pptxgen.Slide, bullets: string[]) {
  bullets.slice(0, 4).forEach((bullet, index) => {
    slide.addText(`${index + 1}`, {
      x: 6.85,
      y: 1.7 + index * 1.08,
      w: 0.35,
      h: 0.35,
      fontFace: "Aptos",
      fontSize: 10,
      bold: true,
      color: "FFFFFF",
      fill: { color: "1D4ED8" },
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(bullet, {
      x: 7.32,
      y: 1.62 + index * 1.08,
      w: 5.05,
      h: 0.62,
      fontFace: "Microsoft YaHei",
      fontSize: 13,
      bold: true,
      color: "111827",
      margin: 0.04,
      fit: "shrink",
    });
  });
}

export async function generateReviewPptxBuffer(
  title: string,
  outlineMarkdown: string,
): Promise<Buffer> {
  const slides = parseSlidesFromMarkdown(outlineMarkdown);
  const pptx = new pptxgen();

  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "ResearchAI";
  pptx.company = "ResearchAI";
  pptx.subject = title;
  pptx.title = title;
  pptx.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };

  slides.forEach((slideContent, index) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    addHeader(slide, slideContent);
    addVisual(slide, slideContent);
    addBulletCards(slide, slideContent.bullets);
    addFooter(slide, index + 1);
  });

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}
