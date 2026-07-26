import { createClient } from "@/lib/supabase/server";
import { buildExportFilename } from "@/lib/export/filename";
import {
  prepareExportPayload,
  sanitizeExportContent,
} from "@/lib/export/content-sanitize";
import { separateArtifactChannels } from "@/lib/export/artifact-boundary";
import {
  buildArtifactRecoveryMessage,
  prepareArtifactContentForExport,
} from "@/lib/export/completeness";
import { ExportError } from "@/lib/export/errors";
import { generateExportBuffer } from "@/lib/export/generators/generate-buffer";
import { assertExportQuality } from "@/lib/export/quality";
import {
  normalizeArtifactContent,
  parseExportRequest,
} from "@/lib/export/service";
import { EXPORT_MIME_TYPES } from "@/lib/export/types";
import type { ExportErrorResponse, ExportFormat } from "@/lib/export/types";

export const runtime = "nodejs";
export const maxDuration = 120;

function logExportError(error: unknown): void {
  if (error instanceof Error) {
    console.error("[export] error name:", error.name);
    console.error("[export] error message:", error.message);
    console.error("[export] error stack:", error.stack);
    return;
  }

  console.error("[export] error name:", typeof error);
  console.error("[export] error message:", String(error));
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

async function generateQualityCheckedBuffer(
  format: ExportFormat,
  input: {
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  },
): Promise<Buffer> {
  const firstBuffer = await generateExportBuffer(format, input);

  try {
    assertExportQuality(format, firstBuffer);
    return firstBuffer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetry =
      format === "docx" &&
      /instruction|markdown|mojibake|乱码|说明|污染|structured|json|figure/i.test(message);

    if (!shouldRetry) throw error;

    const cleanedContent = sanitizeExportContent(input.content, {
      title: input.title,
      userQuery: input.title,
      format,
    });
    const retryBuffer = await generateExportBuffer(format, {
      ...input,
      content: cleanedContent,
    });
    assertExportQuality(format, retryBuffer);
    return retryBuffer;
  }
}

export async function POST(request: Request) {
  console.log("[export] request received");

  try {
    const user = await requireUser();

    if (!user) {
      console.error("[export] unauthorized export request");
      return Response.json(
        { success: false, error: "Unauthorized" } satisfies ExportErrorResponse,
        { status: 401 },
      );
    }

    const body = await request.json();
    const exportRequest = parseExportRequest(body);

    console.log("[export] format:", exportRequest.format);
    console.log("[export] message count:", 1);
    console.log("[export] content length:", exportRequest.content.length);

    const prepared = prepareExportPayload({
      title: exportRequest.title,
      content: exportRequest.content,
      format: exportRequest.format,
    });
    const filename = buildExportFilename(prepared.title, exportRequest.format);
    const normalizedContent = sanitizeExportContent(
      normalizeArtifactContent(exportRequest.format, prepared.content),
      {
        title: prepared.title,
        userQuery: exportRequest.title,
        format: exportRequest.format,
      },
    );
    const initialChannels = separateArtifactChannels(
      exportRequest.format,
      normalizedContent,
    );
    const preparedContent = prepareArtifactContentForExport({
      format: exportRequest.format,
      title: prepared.title,
      content: initialChannels.content,
      metadata: {
        ...(exportRequest.metadata ?? {}),
        visualSpecs: initialChannels.visualSpecs,
      },
    });
    if (preparedContent.report.blocked) {
      throw new ExportError(buildArtifactRecoveryMessage(preparedContent.report), 422);
    }
    const sanitizedFinalContent = sanitizeExportContent(preparedContent.content, {
      title: prepared.title,
      userQuery: exportRequest.title,
      format: exportRequest.format,
    });
    const finalChannels = separateArtifactChannels(
      exportRequest.format,
      sanitizedFinalContent,
    );
    const exportMetadata = {
      ...(exportRequest.metadata ?? {}),
      visualSpecs: [...initialChannels.visualSpecs, ...finalChannels.visualSpecs],
    };
    const buffer = await generateQualityCheckedBuffer(exportRequest.format, {
      title: prepared.title,
      content: finalChannels.content,
      metadata: exportMetadata,
    });

    console.log("[export] created:", filename);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": EXPORT_MIME_TYPES[exportRequest.format],
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Filename": encodeURIComponent(filename),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      logExportError(error);
      return Response.json(
        { success: false, error: error.message } satisfies ExportErrorResponse,
        { status: error.statusCode },
      );
    }

    logExportError(error);

    return Response.json(
      {
        success: false,
        error: "Failed to generate export file.",
      } satisfies ExportErrorResponse,
      { status: 500 },
    );
  }
}
