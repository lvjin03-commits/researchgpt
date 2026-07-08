import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import {
  REVIEW_MIN_PAPER_COUNT,
  REVIEW_MIN_PAPER_COUNT_ERROR,
} from "@/lib/literature/review/constants";
import type { LiteratureReviewResponse } from "@/lib/literature/review/types";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { parseLiteratureReviewRequest } from "@/lib/literature/server/review-parse";
import { loadReviewFolderPapersWithLog } from "@/lib/literature/server/folder-papers";
import {
  generateReviewFullText,
  generateReviewOutline,
  generateReviewPptOutline,
} from "@/lib/literature/server/review-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const record =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};

    console.log("[literature] review generate request body:", {
      folderId: record.folderId,
      folderName: record.folderName,
      topic: record.topic,
    });

    const reviewRequest = parseLiteratureReviewRequest(body);
    const folderNameHint =
      typeof record.folderName === "string" ? record.folderName.trim() : "";
    const uiPaperCount =
      typeof record.uiPaperCount === "number" ? record.uiPaperCount : undefined;

    const { papers, log } = await loadReviewFolderPapersWithLog(
      supabase,
      user.id,
      reviewRequest.folderId,
      { folderNameHint: folderNameHint || undefined },
    );

    console.log("[literature] review generate selected folderId:", log.folderId);
    console.log("[literature] review generate resolved folderId:", log.resolvedFolderId);
    console.log("[literature] review generate resolved folderName:", log.folderName);
    console.log(
      "[literature] review generate uiPaperCount:",
      uiPaperCount ?? "(not provided)",
    );
    console.log(
      "[literature] review generate uiPaperCount source:",
      "GET /api/literature/library?folderId=… (literature-review-shell paperCount state)",
    );
    console.log(
      "[literature] review generate folder link count:",
      log.folderLinkCount,
    );
    console.log(
      "[literature] review generate loaded paper count:",
      log.loadedPaperCount,
    );
    console.log(
      "[literature] review generate sample titles:",
      log.sampleTitles.join(" | ") || "(none)",
    );

    if (
      typeof uiPaperCount === "number" &&
      uiPaperCount !== log.loadedPaperCount
    ) {
      console.warn(
        `[literature] review generate count mismatch: ui=${uiPaperCount} backend=${log.loadedPaperCount} folderLinks=${log.folderLinkCount}`,
      );
    }

    if (papers.length < REVIEW_MIN_PAPER_COUNT) {
      throw new LiteratureError(REVIEW_MIN_PAPER_COUNT_ERROR, 400);
    }

    const usedPaperTitles = papers.map((paper) => paper.title);

    const response: LiteratureReviewResponse = {
      phase: reviewRequest.phase,
      paperCount: papers.length,
      usedPaperTitles,
    };

    if (reviewRequest.phase === "outline") {
      response.outline = await generateReviewOutline(
        reviewRequest,
        papers,
        request.signal,
      );
    } else if (reviewRequest.phase === "full") {
      response.review = await generateReviewFullText(
        reviewRequest,
        papers,
        request.signal,
      );
    } else {
      response.pptOutline = await generateReviewPptOutline(
        reviewRequest,
        papers,
        request.signal,
      );
    }

    return Response.json(response);
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof AIProviderError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] review generate failed:", error);
    return Response.json({ error: "生成文献综述失败。" }, { status: 500 });
  }
}
