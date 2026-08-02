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
import {
  createBaseAssetFingerprint,
  imageRateEstimateUsd,
  isGenerativeRenderStrategy,
  normalizeGenerativeRenderStrategy,
} from "@/lib/document-v2/assets/execution-policy";
import type { ImageExecutionProfile } from "@/lib/document-v2/assets/contracts";
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
    private readonly profile: ImageExecutionProfile,
    private readonly baseAssetCache?: FigureBaseAssetCache,
  ) {}

  requiresProviderCall(request: FigureRequest): boolean {
    return isGenerativeRenderStrategy(
      request.renderStrategy ?? resolveFigureRenderStrategy(request),
    );
  }

  async generate(
    request: FigureRequest,
    context?: { onProviderCall?(): void },
  ): Promise<GeneratedFigureBinary> {
    const renderStrategy =
      request.renderStrategy ?? resolveFigureRenderStrategy(request);
    if (renderStrategy === "deterministic_svg") {
      return renderDeterministicScientificFigure(request);
    }
    if (renderStrategy === "verified_data_plot") {
      throw new Error(
        "verified_data_plot_requires_structured_data: data plots cannot be generated from prose claims.",
      );
    }
    const generativeStrategy = normalizeGenerativeRenderStrategy(renderStrategy);
    if (!generativeStrategy) {
      throw new Error(`unsupported_figure_render_strategy: ${renderStrategy}`);
    }
    if (
      generativeStrategy === "generative_raster_premium" &&
      !this.profile.premiumAuthorization.enabled
    ) {
      throw new Error(
        "premium_image_authorization_required: this task did not authorize premium image generation.",
      );
    }
    const providerConfig =
      generativeStrategy === "generative_raster_premium"
        ? this.profile.premium
        : this.profile.standard;
    const baseAssetFingerprint = createBaseAssetFingerprint({
      request,
      config: providerConfig,
      promptVersion: "document-v2-figure-base-v2",
    });
    const cached = await this.baseAssetCache?.load(baseAssetFingerprint);
    let encoded: string;
    let providerRequestId: string | undefined;
    let cacheHit = false;
    if (cached) {
      encoded = Buffer.from(cached.data).toString("base64");
      providerRequestId = cached.providerRequestId;
      cacheHit = true;
    } else {
      context?.onProviderCall?.();
    const response = await this.client.images.generate({
      model: providerConfig.resolvedModelId,
      size: providerConfig.size,
      quality: providerConfig.quality,
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
      encoded = response.data?.[0]?.b64_json ?? "";
    if (!encoded) throw new Error("The image model returned no PNG data.");
      providerRequestId = (response as { _request_id?: string })._request_id;
      await this.baseAssetCache?.save(baseAssetFingerprint, {
        data: Buffer.from(encoded, "base64"),
        providerRequestId,
        resolvedModel: providerConfig.resolvedModelId,
        resolvedSize: providerConfig.size,
        resolvedQuality: providerConfig.quality,
      });
    }
    const png = await sharp(Buffer.from(encoded, "base64"))
      .png()
      .withMetadata({ density: 300 })
      .toBuffer();
    return overlayFigureLabels({
      request,
      basePng: png,
      baseAssetProvider: providerConfig.provider,
      baseAssetFingerprint,
      providerRequestId,
      resolvedModel: providerConfig.resolvedModelId,
      resolvedSize: providerConfig.size,
      resolvedQuality: providerConfig.quality,
      cacheHit,
      estimatedCostUsd: cacheHit ? 0 : imageRateEstimateUsd(providerConfig),
      costSource: "rate_card_estimate",
      rateCardVersion: this.profile.rateCardVersion,
      capabilityVersion: providerConfig.capabilityVersion,
    });
  }
}

export type FigureBaseAssetCacheRecord = {
  data: Uint8Array;
  providerRequestId?: string;
  resolvedModel?: string;
  resolvedSize?: string;
  resolvedQuality?: string;
};

export interface FigureBaseAssetCache {
  load(fingerprint: string): Promise<FigureBaseAssetCacheRecord | null>;
  save(
    fingerprint: string,
    record: FigureBaseAssetCacheRecord,
  ): Promise<void>;
}
