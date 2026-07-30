import OpenAI from "openai";
import sharp from "sharp";
import { z } from "zod";
import { GeneratedComponentPayloadSchema } from "@/lib/document-v2/orchestration/contracts";
import type { StructuredComponentModel } from "@/lib/document-v2/generation/model-component-generator";
import type {
  FinalFigureGenerator,
  GeneratedFigureBinary,
} from "@/lib/document-v2/assets/figure-pipeline";
import type { FigureRequest } from "@/lib/document-v2/assets/contracts";
import type { DocumentStructuredTextExecutor } from "./text-executor";

const GeneratedComponentEnvelopeSchema = z
  .object({
    payload: GeneratedComponentPayloadSchema,
  })
  .strict();

export class OpenAIStructuredComponentModel implements StructuredComponentModel {
  constructor(
    private readonly executor: DocumentStructuredTextExecutor,
  ) {}

  async generate(input: {
    schemaName: "document_component_payload_v1";
    systemInstruction: string;
    componentInstruction: string;
    componentKey?: string;
  }): Promise<unknown> {
    const response = await this.executor.generate({
      operation: "component.generate",
      componentKey: input.componentKey,
      schemaName: input.schemaName,
      schema: GeneratedComponentEnvelopeSchema,
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

  async generate(request: FigureRequest): Promise<GeneratedFigureBinary> {
    const response = await this.client.images.generate({
      model: this.model,
      size: "1536x1024",
      quality: "high",
      output_format: "png",
      prompt: [
        "Create a publication-ready scientific figure, not a draft or placeholder.",
        `Figure type: ${request.figureType}.`,
        `Title: ${request.title}.`,
        `Content: ${request.contentBrief}.`,
        `Accessibility description: ${request.altText}.`,
        "Use a white background, restrained scientific colors, clear visual hierarchy, Arial labels at readable size, and no decorative elements.",
        "Do not embed a figure number, caption, prompt, evidence IDs, citations, or raw metadata in the image.",
      ].join(" "),
    });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("The image model returned no PNG data.");
    const png = await sharp(Buffer.from(encoded, "base64"))
      .png()
      .withMetadata({ density: 300 })
      .toBuffer();
    return { format: "png", data: png };
  }
}
