import { createHash } from "node:crypto";
import {
  ImageExecutionProfileSchema,
  ImageProviderConfigSchema,
  type FigureRequest,
  type ImageExecutionProfile,
} from "./contracts";

export const IMAGE_CAPABILITY_POLICY_VERSION = "openai-image-capabilities-2026-08-02";
export const IMAGE_RATE_CARD_VERSION = "openai-image-rate-card-2026-08-02";

type SupportedModel = "gpt-image-1-mini" | "gpt-image-2" | "gpt-image-1.5";

const CAPABILITIES: Record<SupportedModel, {
  sizes: ReadonlyArray<"1024x1024" | "1024x1536" | "1536x1024">;
  qualities: ReadonlyArray<"low" | "medium" | "high">;
}> = {
  "gpt-image-1-mini": {
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["low", "medium", "high"],
  },
  "gpt-image-2": {
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["low", "medium", "high"],
  },
  "gpt-image-1.5": {
    sizes: ["1024x1024", "1024x1536", "1536x1024"],
    qualities: ["low", "medium", "high"],
  },
};

const RATE_CARD_USD: Record<SupportedModel, Record<"low" | "medium" | "high", Record<"1024x1024" | "1024x1536" | "1536x1024", number>>> = {
  "gpt-image-1-mini": {
    low: { "1024x1024": 0.005, "1024x1536": 0.006, "1536x1024": 0.006 },
    medium: { "1024x1024": 0.011, "1024x1536": 0.015, "1536x1024": 0.015 },
    high: { "1024x1024": 0.036, "1024x1536": 0.052, "1536x1024": 0.052 },
  },
  "gpt-image-1.5": {
    low: { "1024x1024": 0.009, "1024x1536": 0.013, "1536x1024": 0.013 },
    medium: { "1024x1024": 0.034, "1024x1536": 0.05, "1536x1024": 0.05 },
    high: { "1024x1024": 0.133, "1024x1536": 0.2, "1536x1024": 0.2 },
  },
  "gpt-image-2": {
    low: { "1024x1024": 0.006, "1024x1536": 0.005, "1536x1024": 0.005 },
    medium: { "1024x1024": 0.053, "1024x1536": 0.041, "1536x1024": 0.041 },
    high: { "1024x1024": 0.211, "1024x1536": 0.165, "1536x1024": 0.165 },
  },
};

function supportedModel(model: string): SupportedModel {
  if (model in CAPABILITIES) return model as SupportedModel;
  throw new Error(`unsupported_image_model_configuration: ${model}`);
}

export function resolveImageProviderConfig(input: {
  model: string;
  size: "1024x1024" | "1024x1536" | "1536x1024";
  quality: "low" | "medium" | "high";
}) {
  const model = supportedModel(input.model);
  const capability = CAPABILITIES[model];
  if (!capability.sizes.includes(input.size)) {
    throw new Error(`unsupported_image_size_configuration: ${model}/${input.size}`);
  }
  if (!capability.qualities.includes(input.quality)) {
    throw new Error(`unsupported_image_quality_configuration: ${model}/${input.quality}`);
  }
  return ImageProviderConfigSchema.parse({
    provider: "openai",
    requestedModelId: model,
    resolvedModelId: model,
    size: input.size,
    quality: input.quality,
    outputFormat: "png",
    capabilityVersion: IMAGE_CAPABILITY_POLICY_VERSION,
  });
}

export function createImageExecutionProfile(input: {
  visualIntent: "auto" | "required" | "forbidden";
  frozenAt?: string;
}): ImageExecutionProfile {
  return ImageExecutionProfileSchema.parse({
    schemaVersion: 1,
    standard: resolveImageProviderConfig({
      model: process.env.OPENAI_IMAGE_STANDARD_MODEL ?? "gpt-image-1-mini",
      size: "1536x1024",
      quality: "medium",
    }),
    premium: resolveImageProviderConfig({
      model: process.env.OPENAI_IMAGE_PREMIUM_MODEL ?? "gpt-image-2",
      size: "1536x1024",
      quality: "high",
    }),
    premiumAuthorization: {
      enabled: false,
      maximumFigures: 0,
      maximumEstimatedCostUsd: 0,
    },
    failurePolicy:
      input.visualIntent === "required"
        ? "pause_before_delivery"
        : input.visualIntent === "forbidden"
          ? "deliver_without_failed_figures"
          : "deliver_with_deterministic_fallback",
    rateCardVersion: IMAGE_RATE_CARD_VERSION,
    frozenAt: input.frozenAt ?? new Date().toISOString(),
  });
}

export function imageRateEstimateUsd(config: ImageExecutionProfile["standard"]): number {
  const model = supportedModel(config.resolvedModelId);
  return RATE_CARD_USD[model][config.quality][config.size];
}

function normalizeSemanticText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function createBaseAssetFingerprint(input: {
  request: FigureRequest;
  config: ImageExecutionProfile["standard"];
  promptVersion: string;
}): string {
  const canonical = {
    figureType: input.request.figureType,
    semanticNodes: input.request.claimsRepresented.map(normalizeSemanticText),
    semanticRelations: [
      normalizeSemanticText(input.request.questionAnswered),
      normalizeSemanticText(input.request.contentBrief),
    ],
    visualStyleId: "sci-white-restrained-v1",
    aspectRatio: input.config.size,
    backgroundPolicy: "opaque-white",
    provider: input.config.provider,
    model: input.config.resolvedModelId,
    quality: input.config.quality,
    promptVersion: input.promptVersion,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function isGenerativeRenderStrategy(strategy: FigureRequest["renderStrategy"]): boolean {
  return strategy === "textless_raster_overlay" ||
    strategy === "generative_raster_standard" ||
    strategy === "generative_raster_premium";
}

export function normalizeGenerativeRenderStrategy(strategy: FigureRequest["renderStrategy"]): "generative_raster_standard" | "generative_raster_premium" | undefined {
  if (strategy === "generative_raster_premium") return strategy;
  if (strategy === "generative_raster_standard" || strategy === "textless_raster_overlay") {
    return "generative_raster_standard";
  }
  return undefined;
}
