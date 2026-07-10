// Server-only module.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { extractImages, extractText, getDocumentProxy } from "unpdf";
import { LiteratureError } from "@/lib/literature/errors";
import { extractFigureEvidenceFromText } from "@/lib/literature/server/figure-evidence";
import {
  downloadStoredPdfBuffer,
  ensureLiteraturePaperFullText,
} from "@/lib/literature/server/pdf-archive";
import { updateLiteraturePaperPdfArchive } from "@/lib/literature/server/repository";
import type {
  LiteratureFigureEvidence,
  LiteraturePaper,
} from "@/lib/literature/types";

const LITERATURE_PDFS_BUCKET = "literature-pdfs";
const MAX_PAGES = 100;
const MAX_EXTRACTED_IMAGES = 48;
const MIN_IMAGE_WIDTH = 240;
const MIN_IMAGE_HEIGHT = 140;
const MIN_IMAGE_AREA = 80_000;
const MAX_IMAGE_AREA = 32_000_000;

export type FigureExtractionSummary = {
  pagesScanned: number;
  imagesExtracted: number;
  captionsMatched: number;
  captionOnlyEvidence: number;
  skippedImages: number;
  truncated: boolean;
};

function isResearchFigureSize(width: number, height: number): boolean {
  const area = width * height;
  const aspectRatio = width / height;
  return (
    width >= MIN_IMAGE_WIDTH &&
    height >= MIN_IMAGE_HEIGHT &&
    area >= MIN_IMAGE_AREA &&
    area <= MAX_IMAGE_AREA &&
    aspectRatio >= 0.08 &&
    aspectRatio <= 12
  );
}

function imageEvidenceId(
  paperId: string,
  page: number,
  digest: string,
): string {
  return `${paperId}-page-${page}-${digest.slice(0, 12)}`.replace(
    /[^a-zA-Z0-9_-]+/g,
    "-",
  );
}

function mergeCaptionEvidence(
  captionEvidence: LiteratureFigureEvidence[],
  imageEvidence: LiteratureFigureEvidence[],
): LiteratureFigureEvidence[] {
  const imageLabels = new Set(
    imageEvidence
      .filter((item) => item.captionMatched)
      .map((item) => `${item.page}:${item.kind}:${item.label.toLowerCase()}`),
  );
  const unmatchedCaptions = captionEvidence.filter(
    (item) =>
      !imageLabels.has(`${item.page}:${item.kind}:${item.label.toLowerCase()}`),
  );
  return [...imageEvidence, ...unmatchedCaptions].slice(0, 80);
}

export async function extractAndStoreLiteraturePaperFigures(
  supabase: SupabaseClient,
  userId: string,
  sourcePaper: LiteraturePaper,
): Promise<{ paper: LiteraturePaper; summary: FigureExtractionSummary }> {
  const paper = await ensureLiteraturePaperFullText(supabase, userId, sourcePaper);
  const { buffer, storagePath, fileName } = await downloadStoredPdfBuffer(
    supabase,
    userId,
    paper,
  );
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text: pageTexts } = await extractText(pdf, { mergePages: false });
  const pagesScanned = Math.min(pdf.numPages, MAX_PAGES);
  const captionEvidence = pageTexts
    .slice(0, pagesScanned)
    .flatMap((pageText, pageIndex) =>
      extractFigureEvidenceFromText(pageText, paper).map((item) => ({
        ...item,
        id: `${item.id}-page-${pageIndex + 1}`,
        page: pageIndex + 1,
      })),
    );

  const storedImages: LiteratureFigureEvidence[] = [];
  const seenDigests = new Set<string>();
  let skippedImages = 0;
  let captionsMatched = 0;
  let truncated = pdf.numPages > MAX_PAGES;

  for (let pageNumber = 1; pageNumber <= pagesScanned; pageNumber += 1) {
    if (storedImages.length >= MAX_EXTRACTED_IMAGES) {
      truncated = true;
      break;
    }

    const pageImages = await extractImages(pdf, pageNumber);
    const pageCaptions = captionEvidence.filter((item) => item.page === pageNumber);
    let acceptedOnPage = 0;

    for (const image of pageImages) {
      if (storedImages.length >= MAX_EXTRACTED_IMAGES) {
        truncated = true;
        break;
      }
      if (!isResearchFigureSize(image.width, image.height)) {
        skippedImages += 1;
        continue;
      }

      const digest = createHash("sha256")
        .update(`${image.width}x${image.height}x${image.channels}:`)
        .update(image.data)
        .digest("hex");
      if (seenDigests.has(digest)) {
        skippedImages += 1;
        continue;
      }
      seenDigests.add(digest);

      const pngBuffer = await sharp(Buffer.from(image.data), {
        raw: {
          width: image.width,
          height: image.height,
          channels: image.channels,
        },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const imagePath = `${userId}/${paper.id}/figures/${digest.slice(0, 24)}.png`;
      const { error: uploadError } = await supabase.storage
        .from(LITERATURE_PDFS_BUCKET)
        .upload(imagePath, pngBuffer, {
          contentType: "image/png",
          upsert: true,
        });
      if (uploadError) {
        throw new LiteratureError(
          `图表保存失败：${uploadError.message}`,
          500,
        );
      }

      const matchedCaption = pageCaptions[acceptedOnPage] ?? null;
      if (matchedCaption) captionsMatched += 1;
      acceptedOnPage += 1;
      const fallbackLabel = `Page ${pageNumber} image ${acceptedOnPage}`;
      storedImages.push({
        id: imageEvidenceId(paper.id, pageNumber, digest),
        kind: matchedCaption?.kind ?? "figure",
        label: matchedCaption?.label ?? fallbackLabel,
        caption:
          matchedCaption?.caption ??
          `从《${paper.title}》第 ${pageNumber} 页提取的原始图片，未可靠匹配到图注，请人工确认后引用。`,
        sourceTitle: paper.title,
        page: pageNumber,
        topics: matchedCaption?.topics ?? [],
        imageStoragePath: imagePath,
        imageMimeType: "image/png",
        imageWidth: image.width,
        imageHeight: image.height,
        extractionMethod: "embedded_image",
        captionMatched: Boolean(matchedCaption),
      });
    }
  }

  const figureEvidence = mergeCaptionEvidence(captionEvidence, storedImages);
  const extractedAt = new Date().toISOString();
  const updatedPaper = await updateLiteraturePaperPdfArchive(
    supabase,
    userId,
    paper.id,
    {
      pdfStoragePath: storagePath,
      pdfFileName: fileName,
      pdfFileSize: buffer.byteLength,
      pdfDownloadStatus: "stored",
      pdfDownloadError: null,
      fullText: paper.fullText,
      fullTextExtractedAt: paper.fullTextExtractedAt,
      figureEvidence,
      figureEvidenceExtractedAt: extractedAt,
    },
  );

  return {
    paper: updatedPaper,
    summary: {
      pagesScanned,
      imagesExtracted: storedImages.length,
      captionsMatched,
      captionOnlyEvidence: figureEvidence.filter(
        (item) => !item.imageStoragePath,
      ).length,
      skippedImages,
      truncated,
    },
  };
}
