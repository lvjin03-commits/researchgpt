import type { FinalDocumentSpec } from "../contracts";

export const SCI_WORD_STYLE_REGISTRY = Object.freeze({
  registryVersion: "sci-word-style-v1",
  page: {
    widthDxa: 11_906,
    heightDxa: 16_838,
    verticalMarginDxa: 1_134,
    horizontalMarginDxa: 1_247,
  },
  colors: {
    title: "111111",
    text: "222222",
    caption: "444444",
    tableHeaderFill: "F2F2F2",
  },
  paragraphRoles: {
    title: { sizePt: 22, beforePt: 0, afterPt: 12 },
    heading1: { sizePt: 13, beforePt: 14, afterPt: 5 },
    heading2: { sizePt: 11, beforePt: 10, afterPt: 4 },
    heading3: { sizePt: 10, beforePt: 8, afterPt: 3 },
    body: { sizePt: 10, lineTwips: 276, afterPt: 6 },
    abstract: { sizePt: 9.5, lineTwips: 264, afterPt: 8 },
    keywords: { sizePt: 9.5, lineTwips: 240, afterPt: 8 },
    caption: { sizePt: 8.5, lineTwips: 240, beforePt: 6, afterPt: 3 },
    reference: { sizePt: 8.5, lineTwips: 240, afterPt: 3, hangingDxa: 283 },
    tableHeader: { sizePt: 9 },
    tableBody: { sizePt: 8.5 },
  },
});

export function resolveSciWordFonts(
  language: FinalDocumentSpec["metadata"]["language"],
) {
  return language === "zh"
    ? {
        title: {
          ascii: "Arial",
          hAnsi: "Arial",
          eastAsia: "Microsoft YaHei",
        },
        body: {
          ascii: "Times New Roman",
          hAnsi: "Times New Roman",
          eastAsia: "SimSun",
        },
        caption: {
          ascii: "Arial",
          hAnsi: "Arial",
          eastAsia: "Microsoft YaHei",
        },
      }
    : {
        title: "Arial",
        body: "Times New Roman",
        caption: "Arial",
      };
}
