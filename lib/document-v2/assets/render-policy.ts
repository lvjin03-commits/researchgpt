import { createHash } from "node:crypto";
import type {
  FigureLabelSpec,
  FigureRequest,
  FigureRequestDraft,
} from "./contracts";

export type FigureRenderStrategy =
  | "deterministic_svg"
  | "generative_raster_standard"
  | "generative_raster_premium"
  | "textless_raster_overlay"
  | "verified_data_plot";

type FigurePolicyInput = FigureRequestDraft | FigureRequest;

const COMPLEX_SPATIAL_VISUAL_PATTERN =
  /(?:microstructure|morpholog|cross[- ]?section|porous|pore network|molecular chain|polymer chain|cellular|histolog|three[- ]?dimensional|3d\b|spatial distribution|phase separation|微观形貌|材料剖面|截面|孔隙网络|分子链|聚合物链|细胞环境|组织学|三维形貌|空间分布|相分离)/iu;

export function assessFigureComplexity(input: FigurePolicyInput) {
  const semanticText = [
    input.title,
    input.contentBrief,
    input.questionAnswered,
    ...input.claimsRepresented,
  ].join(" ");
  const spatialIllustrationRequired = COMPLEX_SPATIAL_VISUAL_PATTERN.test(
    semanticText,
  );
  const realisticMorphologyRequired =
    input.figureType === "mechanism_diagram" && spatialIllustrationRequired;
  const labelCount = input.claimsRepresented.length;
  const topologyComplexity = Math.min(
    10,
    labelCount + (input.figureType === "mechanism_diagram" ? 2 : 0),
  );
  const deterministicRenderability =
    input.figureType === "data_plot"
      ? 1
      : realisticMorphologyRequired
        ? 0.25
        : labelCount > 8
          ? 0.65
          : 0.9;
  return {
    topologyComplexity,
    spatialIllustrationRequired,
    realisticMorphologyRequired,
    dataDriven: input.figureType === "data_plot",
    labelCount,
    deterministicRenderability,
  } as const;
}

export function resolveFigureRenderStrategy(
  input: FigureRequestDraft["figureType"] | FigurePolicyInput,
): FigureRenderStrategy {
  const figureType = typeof input === "string" ? input : input.figureType;
  if (figureType === "data_plot") return "verified_data_plot";
  if (figureType === "mechanism_diagram" && typeof input !== "string") {
    const assessment = assessFigureComplexity(input);
    if (assessment.deterministicRenderability < 0.7) {
      return "generative_raster_standard";
    }
  }
  return "deterministic_svg";
}

export function resolveFigureTextRenderingMode(input: FigurePolicyInput) {
  const strategy =
    ("renderStrategy" in input ? input.renderStrategy : undefined) ??
    resolveFigureRenderStrategy(input);
  if (input.claimsRepresented.length > 8) return "numbered_legend" as const;
  return strategy === "deterministic_svg" || strategy === "verified_data_plot"
    ? "native_deterministic" as const
    : "program_overlay" as const;
}

export function createFigureLabelSpecs(input: {
  requestId: string;
  claimsRepresented: ReadonlyArray<string>;
}): FigureLabelSpec[] {
  return input.claimsRepresented.map((text, index) => {
    const digest = createHash("sha256")
      .update(input.requestId)
      .update("\0")
      .update(String(index))
      .update("\0")
      .update(text)
      .digest("hex")
      .slice(0, 20);
    return {
      labelId: `figure-label-${digest}`,
      text,
      role: "callout",
      anchorId: `claim-${index + 1}`,
      preferredPlacement: "auto",
      maxLines: 4,
      maxWidthRatio: 0.42,
      priority: "required",
    };
  });
}
