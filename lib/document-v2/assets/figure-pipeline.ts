import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  FigureAssetSchema,
  FigureRequestSchema,
  type FigureAsset,
  type FigureRequest,
} from "./contracts";

const MINIMUM_WIDTH_PX = 900;
const MINIMUM_HEIGHT_PX = 400;
const MAXIMUM_FILE_BYTES = 25 * 1024 * 1024;
const MAXIMUM_DISPLAY_WIDTH_PX = 627;
const PIXELS_PER_MM_AT_96_DPI = 96 / 25.4;

export interface GeneratedFigureBinary {
  format: "png" | "svg";
  data: Uint8Array;
  fallbackPng?: Uint8Array;
}

export interface FinalFigureGenerator {
  generate(request: FigureRequest): Promise<GeneratedFigureBinary>;
}

export interface FigureAssetMaterializer {
  materialize(
    request: FigureRequest,
    context?: { onProviderCall?(): void },
  ): Promise<FigureAsset>;
}

export class FigureAssetQualityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigureAssetQualityError";
  }
}

function assertFileSize(data: Uint8Array, label: string): void {
  if (data.byteLength === 0 || data.byteLength > MAXIMUM_FILE_BYTES) {
    throw new FigureAssetQualityError(
      `${label} must contain 1-${MAXIMUM_FILE_BYTES} bytes.`,
    );
  }
}

function validateSvg(data: Uint8Array): void {
  const source = Buffer.from(data).toString("utf8");
  if (!/<svg[\s>]/i.test(source)) {
    throw new FigureAssetQualityError("SVG output has no root svg element.");
  }
  if (
    /<script|<foreignObject|\son\w+\s*=|(?:href|xlink:href)\s*=\s*["']https?:/i.test(
      source,
    )
  ) {
    throw new FigureAssetQualityError(
      "SVG output contains executable or externally loaded content.",
    );
  }
}

async function inspectPng(data: Uint8Array) {
  assertFileSize(data, "PNG");
  const metadata = await sharp(data).metadata();
  if (metadata.format !== "png") {
    throw new FigureAssetQualityError("Figure bitmap must be a valid PNG.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  const dpi = Math.round(metadata.density ?? 0);
  if (width < MINIMUM_WIDTH_PX || height < MINIMUM_HEIGHT_PX) {
    throw new FigureAssetQualityError(
      `Figure bitmap is ${width}x${height}; minimum is ${MINIMUM_WIDTH_PX}x${MINIMUM_HEIGHT_PX}.`,
    );
  }
  if (dpi < 300) {
    throw new FigureAssetQualityError(
      `Figure bitmap density is ${dpi || "missing"} dpi; minimum is 300 dpi.`,
    );
  }
  return { width, height, dpi };
}

export class ValidatedFigureAssetPipeline
  implements FigureAssetMaterializer
{
  constructor(
    private readonly generator: FinalFigureGenerator,
    private readonly maxAttempts = 2,
  ) {
    if (
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 5
    ) {
      throw new RangeError("Figure maxAttempts must be between 1 and 5.");
    }
  }

  async materialize(
    input: FigureRequest,
    context?: { onProviderCall?(): void },
  ): Promise<FigureAsset> {
    const request = FigureRequestSchema.parse(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        context?.onProviderCall?.();
        return await this.generateAndValidate(request);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new FigureAssetQualityError("Figure generation failed.");
  }

  private async generateAndValidate(
    request: FigureRequest,
  ): Promise<FigureAsset> {
    const generated = await this.generator.generate(request);
    assertFileSize(generated.data, generated.format.toUpperCase());

    let pngData: Uint8Array;
    if (generated.format === "svg") {
      validateSvg(generated.data);
      if (!generated.fallbackPng) {
        throw new FigureAssetQualityError(
          "SVG output requires a high-resolution PNG fallback.",
        );
      }
      pngData = generated.fallbackPng;
    } else {
      if (generated.fallbackPng) {
        throw new FigureAssetQualityError(
          "PNG output cannot define a second PNG fallback.",
        );
      }
      pngData = generated.data;
    }

    const { width, height, dpi } = await inspectPng(pngData);
    const naturalDisplayWidth = Math.max(1, Math.floor((width / dpi) * 96));
    const displayWidthPx = Math.min(
      MAXIMUM_DISPLAY_WIDTH_PX,
      naturalDisplayWidth,
    );
    const displayHeightPx = Math.max(
      1,
      Math.round(displayWidthPx * (height / width)),
    );
    const aspectRatio = width / height;
    const labelDensity =
      request.claimsRepresented.length >= 7
        ? "high"
        : request.claimsRepresented.length >= 4
          ? "medium"
          : "low";
    const minimumReadableWidthMm =
      labelDensity === "high" ? 135 : labelDensity === "medium" ? 110 : 90;
    const preferredDisplayWidthMm = Math.min(
      165,
      Math.max(
        minimumReadableWidthMm,
        Math.round(displayWidthPx / PIXELS_PER_MM_AT_96_DPI),
      ),
    );
    const preferredLayout =
      aspectRatio > 1.65 || labelDensity === "high"
        ? "full_width"
        : aspectRatio < 0.85
          ? "dedicated_page"
          : "inline_wide";
    const hash = createHash("sha256")
      .update(generated.data)
      .update(generated.fallbackPng ?? new Uint8Array())
      .digest("hex");

    return FigureAssetSchema.parse({
      id: `${request.requestId}-asset`,
      requestId: request.requestId,
      format: generated.format,
      dataBase64: Buffer.from(generated.data).toString("base64"),
      fallbackPngBase64: generated.fallbackPng
        ? Buffer.from(generated.fallbackPng).toString("base64")
        : undefined,
      pixelWidth: width,
      pixelHeight: height,
      dpi,
      displayWidthPx,
      displayHeightPx,
      preferredDisplayWidthMm,
      minimumReadableWidthMm,
      labelDensity,
      preferredLayout,
      sha256: hash,
      title: request.title,
      altText: request.altText,
    });
  }
}
