import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FigureAsset } from "@/lib/document-v2/assets/contracts";
import type { FigureAssetMaterializer } from "@/lib/document-v2/assets/figure-pipeline";
import { ValidatedFigureAssetPipeline } from "@/lib/document-v2/assets/figure-pipeline";
import type { ImageExecutionProfile } from "@/lib/document-v2/assets/contracts";
import { isGenerativeRenderStrategy } from "@/lib/document-v2/assets/execution-policy";
import { renderDeterministicScientificFigure } from "@/lib/document-v2/assets/deterministic-figure-renderer";
import { OpenAIFinalFigureGenerator } from "./openai-adapters";
import {
  createFigureBaseAssetCache,
  storeFigureAsset,
} from "./artifact-storage";

export function createFigureAssetMaterializer(input: {
  supabase: SupabaseClient;
  ownerId: string;
  jobId: string;
  imageExecution: ImageExecutionProfile;
  openAiApiKey?: string;
}): FigureAssetMaterializer {
  return {
    async materialize(request, context) {
      const materializeDeterministic = () =>
        new ValidatedFigureAssetPipeline(
          {
            async generate(fallbackRequest) {
              return renderDeterministicScientificFigure(fallbackRequest);
            },
          },
          1,
        ).materialize({
          ...request,
          renderStrategy: "deterministic_svg",
          textRenderingMode: "native_deterministic",
        });
      const providerRequired = isGenerativeRenderStrategy(
        request.renderStrategy,
      );
      if (!providerRequired) {
        return storeFigureAsset(
          input.supabase,
          input.ownerId,
          input.jobId,
          await materializeDeterministic(),
        );
      }
      if (!input.openAiApiKey) {
        if (
          input.imageExecution.failurePolicy ===
          "deliver_with_deterministic_fallback"
        ) {
          return storeFigureAsset(
            input.supabase,
            input.ownerId,
            input.jobId,
            await materializeDeterministic(),
          );
        }
        throw new Error(
          "openai_image_provider_not_configured: this job requires a complex image but OPENAI_API_KEY is unavailable.",
        );
      }
      const generator = new OpenAIFinalFigureGenerator(
        new OpenAI({
          apiKey: input.openAiApiKey,
          timeout: 75_000,
          maxRetries: 0,
        }),
        input.imageExecution,
        createFigureBaseAssetCache({
          supabase: input.supabase,
          ownerId: input.ownerId,
        }),
      );
      const pipeline = new ValidatedFigureAssetPipeline(generator, 1);
      let asset: FigureAsset;
      try {
        asset = await pipeline.materialize(request, context);
      } catch (error) {
        if (
          input.imageExecution.failurePolicy !==
            "deliver_with_deterministic_fallback" ||
          request.renderStrategy === "deterministic_svg" ||
          request.renderStrategy === "verified_data_plot"
        ) {
          throw error;
        }
        asset = await materializeDeterministic();
      }
      return storeFigureAsset(
        input.supabase,
        input.ownerId,
        input.jobId,
        asset,
      );
    },
  };
}
