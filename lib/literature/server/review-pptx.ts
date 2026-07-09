// Server-only module.

import pptxgen from "pptxgenjs";

type SlideContent = {
  title: string;
  bullets: string[];
};

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

function parseSlidesFromMarkdown(content: string): SlideContent[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const chunks = normalized
    .split(/\n(?=##\s+)/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length === 0) {
    return [{ title: "文献综述", bullets: [normalized || "暂无内容"] }];
  }

  return chunks.map((chunk, index) => {
    const lines = chunk
      .split("\n")
      .map((line) => stripMarkdown(line))
      .filter(Boolean);
    const title = lines[0] || `幻灯片 ${index + 1}`;
    const bullets = lines.slice(1).filter((line) => line !== title);

    return {
      title,
      bullets: bullets.length > 0 ? bullets.slice(0, 8) : ["见综述正文"],
    };
  });
}

function addTitle(slide: pptxgen.Slide, title: string) {
  slide.addText(title, {
    x: 0.55,
    y: 0.35,
    w: 8.9,
    h: 0.65,
    fontFace: "Microsoft YaHei",
    fontSize: 24,
    bold: true,
    color: "111827",
    margin: 0,
    breakLine: false,
    fit: "shrink",
  });
}

function addBullets(slide: pptxgen.Slide, bullets: string[]) {
  const bulletRuns = bullets.map((bullet) => ({
    text: bullet,
    options: {
      bullet: { type: "bullet" as const },
      breakLine: true,
      hanging: 4,
    },
  }));

  slide.addText(bulletRuns, {
    x: 0.85,
    y: 1.35,
    w: 8.15,
    h: 4.45,
    fontFace: "Microsoft YaHei",
    fontSize: 15,
    color: "1F2937",
    valign: "top",
    fit: "shrink",
    margin: 0.08,
    paraSpaceAfter: 8,
    breakLine: false,
  });
}

function addFooter(slide: pptxgen.Slide, pageNumber: number) {
  slide.addText(`ResearchAI · ${pageNumber}`, {
    x: 0.55,
    y: 6.35,
    w: 8.9,
    h: 0.25,
    fontFace: "Aptos",
    fontSize: 8,
    color: "6B7280",
    align: "right",
    margin: 0,
  });
}

export async function generateReviewPptxBuffer(
  title: string,
  outlineMarkdown: string,
): Promise<Buffer> {
  const slides = parseSlidesFromMarkdown(outlineMarkdown);
  const pptx = new pptxgen();

  pptx.layout = "LAYOUT_4x3";
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
    addTitle(slide, slideContent.title);
    addBullets(slide, slideContent.bullets);
    addFooter(slide, index + 1);
  });

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}
