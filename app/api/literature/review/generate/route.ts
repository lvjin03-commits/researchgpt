import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import type { LiteratureReviewResponse } from "@/lib/literature/review/types";
import { requireLiteratureUser } from "@/lib/literature/server/auth";
import { parseLiteratureReviewRequest } from "@/lib/literature/server/review-parse";
import { loadReviewFolderPapers } from "@/lib/literature/server/review-papers";
import {
  buildReviewWarnings,
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
    const reviewRequest = parseLiteratureReviewRequest(body);

    const papers = await loadReviewFolderPapers(
      supabase,
      user.id,
      reviewRequest.folderId,
      reviewRequest.timeRange,
      reviewRequest.customTimeRangeYears,
    );

    if (papers.length === 0) {
      throw new LiteratureError("所选文件夹中没有符合时间范围的文献。", 400);
    }

    const warnings = buildReviewWarnings(papers.length);
    const usedPaperTitles = papers.map((paper) => paper.title);

    const response: LiteratureReviewResponse = {
      phase: reviewRequest.phase,
      paperCount: papers.length,
      usedPaperTitles,
      ...(warnings.length > 0 ? { warnings } : {}),
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
