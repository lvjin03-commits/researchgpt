import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import { sortLiteraturePapersAfterAiRerank } from "@/lib/literature/ranking/final-sort";
import { analyzeArxivPapers } from "@/lib/literature/server/analyze-service";
import { searchLiteratureProviders } from "@/lib/literature/server/fetch-papers";
import { limitPapersForAnalysis } from "@/lib/literature/server/limit-analysis-papers";
import { logLiteraturePipelineCounts } from "@/lib/literature/server/pipeline-log";
import { parseLiteratureSettings } from "@/lib/literature/server/parse";
import {
  listLiteraturePapers,
  saveLiteratureSettings,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export async function POST(request: Request) {
  const requestStartedAt = Date.now();
  console.log("[literature] update request received");

  try {
    console.log("[literature] step parse request: start");
    const parseStartedAt = Date.now();
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const { settings } = parseLiteratureSettings(body, {
      requireEnabledSources: true,
    });
    console.log(
      `[literature] step parse request: done elapsedMs=${elapsedMs(parseStartedAt)}`,
    );

    console.log("[literature] discipline:", settings.discipline);
    console.log("[literature] selectedSources:", settings.selectedSources.join(", "));
    console.log("[literature] keywords:", settings.keywords);
    console.log("[literature] dateRangeDays:", settings.dateRangeDays);

    console.log("[literature] step load settings: start");
    const loadSettingsStartedAt = Date.now();
    await saveLiteratureSettings(supabase, user.id, settings);
    console.log(
      `[literature] step load settings: done elapsedMs=${elapsedMs(loadSettingsStartedAt)}`,
    );

    const { drafts, quality, debug, failedProviders, warnings } =
      await searchLiteratureProviders(settings);
    const analysisDrafts = limitPapersForAnalysis(drafts);

    console.log("[literature] step openai rerank analysis: start");
    const analysisStartedAt = Date.now();
    const analysisById = await analyzeArxivPapers(
      analysisDrafts,
      settings,
      request.signal,
    );
    console.log(
      `[literature] step openai rerank analysis: done elapsedMs=${elapsedMs(analysisStartedAt)} analyzed=${analysisById.size}`,
    );

    console.log("[literature] step save to supabase: start");
    const saveStartedAt = Date.now();
    await upsertAnalyzedPapers(supabase, user.id, analysisDrafts, analysisById);
    const currentResultIds = new Set(
      analysisDrafts.map((paper) => paper.arxivId),
    );
    const papers = sortLiteraturePapersAfterAiRerank(
      (await listLiteraturePapers(supabase, user.id)).filter((paper) =>
        currentResultIds.has(paper.arxivId),
      ),
    );
    const finalReturned = papers.filter((paper) => paper.status !== "skipped").length;

    logLiteraturePipelineCounts({
      totalFetched: quality.fetchedTotal,
      afterDedup: quality.afterExcludeKeywords,
      afterRanking: quality.finalCount,
      sentToAi: analysisDrafts.length,
      finalReturned,
    });

    console.log(
      `[literature] step save to supabase: done elapsedMs=${elapsedMs(saveStartedAt)} papers=${papers.length}`,
    );

    console.log("[literature] step return response: start");
    const returnStartedAt = Date.now();
    const response = Response.json({
      settings,
      papers,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(failedProviders.length > 0
        ? { failedProviders: failedProviders.map((provider) => provider) }
        : {}),
      ...(debug ? { debug } : {}),
    });
    console.log(
      `[literature] step return response: done elapsedMs=${elapsedMs(returnStartedAt)}`,
    );
    console.log(
      `[literature] update request complete totalRequestDurationMs=${elapsedMs(requestStartedAt)}`,
    );

    return response;
  } catch (error) {
    console.log(
      `[literature] update request failed totalRequestDurationMs=${elapsedMs(requestStartedAt)}`,
    );

    if (error instanceof LiteratureError) {
      console.error("[literature] update error:", error.message);
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof AIProviderError) {
      console.error("[literature] update AI error:", error.message);
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof Error) {
      console.error("[literature] update error name:", error.name);
      console.error("[literature] update error message:", error.message);
      console.error("[literature] update error stack:", error.stack);
    }

    return Response.json(
      { error: "Failed to update literature papers." },
      { status: 500 },
    );
  }
}
