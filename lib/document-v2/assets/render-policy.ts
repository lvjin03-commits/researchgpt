import { createHash } from "node:crypto";
import type {
  FigureLabelSpec,
  FigureRequestDraft,
} from "./contracts";

export type FigureRenderStrategy =
  | "deterministic_svg"
  | "textless_raster_overlay"
  | "verified_data_plot";

export function resolveFigureRenderStrategy(
  figureType: FigureRequestDraft["figureType"],
): FigureRenderStrategy {
  if (figureType === "data_plot") return "verified_data_plot";
  if (figureType === "mechanism_diagram") {
    return "textless_raster_overlay";
  }
  return "deterministic_svg";
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
