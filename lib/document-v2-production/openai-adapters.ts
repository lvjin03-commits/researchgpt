import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import type { StructuredComponentModel } from "@/lib/document-v2/generation/model-component-generator";
import type {
  FinalFigureGenerator,
  GeneratedFigureBinary,
} from "@/lib/document-v2/assets/figure-pipeline";
import type { FigureRequest } from "@/lib/document-v2/assets/contracts";
import {
  overlayFigureLabels,
  renderDeterministicScientificFigure,
} from "@/lib/document-v2/assets/deterministic-figure-renderer";
import { resolveFigureRenderStrategy } from "@/lib/document-v2/assets/render-policy";
import type { DocumentStructuredTextExecutor } from "./text-executor";
import type { DocumentOperationBudgetKey } from "@/lib/document-v2/runtime/token-budgets";

export class OpenAIStructuredComponentModel implements StructuredComponentModel {
  constructor(
    private readonly executor: DocumentStructuredTextExecutor,
  ) {}

  async generate(input: {
    schemaName: string;
    schema: z.ZodType;
    systemInstruction: string;
    componentInstruction: string;
    componentKey?: string;
    budgetKey?: DocumentOperationBudgetKey;
  }): Promise<unknown> {
    const envelopeSchema = z.object({ payload: input.schema }).strict();
    const response = await this.executor.generate({
      operation: "component.generate",
      componentKey: input.componentKey,
      budgetKey: input.budgetKey,
      schemaName: input.schemaName,
      schema: envelopeSchema,
      systemInstruction: input.systemInstruction,
      userInstruction: input.componentInstruction,
    });
    return response.payload;
  }
}

export class OpenAIFinalFigureGenerator implements FinalFigureGenerator {
  constructor(
    private readonly client: OpenAI,
    private readonly model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5",
  ) {}

  requiresProviderCall(request: FigureRequest): boolean {
    return (
      (request.renderStrategy ??
        resolveFigureRenderStrategy(request.figureType)) ===
      "textless_raster_overlay"
    );
  }

  async generate(request: FigureRequest): Promise<GeneratedFigureBinary> {
    const renderStrategy =
      request.renderStrategy ?? resolveFigureRenderStrategy(request.figureType);
    if (renderStrategy === "deterministic_svg") {
      return renderDeterministicScientificFigure(request);
    }
    if (renderStrategy === "verified_data_plot") {
      throw new Error(
        "verified_data_plot_requires_structured_data: data plots cannot be generated from prose claims.",
      );
    }
    const response = await this.client.images.generate({
      model: this.model,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
      prompt: [
        "Create a publication-ready scientific figure, not a draft or placeholder.",
        `Figure type: ${request.figureType}.`,
        `Title: ${request.title}.`,
        `Question the figure must answer: ${request.questionAnswered}.`,
        `Evidence mode: ${request.evidenceMode}.`,
        `Claims represented: ${request.claimsRepresented.join("; ")}.`,
        `Content: ${request.contentBrief}.`,
        `Accessibility description: ${request.altText}.`,
        request.evidenceMode === "conceptual"
          ? "This is a conceptual schematic: do not invent measurements, numeric axes, data points, or quantitative precision."
          : "Represent only the supplied evidence-backed claims and do not invent unsupported measurements.",
        "Use a white background, restrained scientific colors, clear visual hierarchy, and no decorative elements.",
        "Generate the visual layer only. Do not render any text, letters, numbers, symbols, labels, legend, watermark, figure number, caption, prompt, evidence IDs, citations, or raw metadata anywhere in the image.",
      ].join(" "),
    });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("The image model returned no PNG data.");
    const png = await sharp(Buffer.from(encoded, "base64"))
      .png()
      .withMetadata({ density: 300 })
      .toBuffer();
    return overlayFigureLabels({
      request,
      basePng: png,
      baseAssetProvider: this.model,
    });
  }
}
