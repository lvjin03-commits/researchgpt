import { AIProviderError } from "@/lib/ai/errors";
import { LiteratureError } from "@/lib/literature/errors";
import { analyzeArxivPapers } from "@/lib/literature/server/analyze-service";
import { fetchPapersFromSelectedSources } from "@/lib/literature/server/fetch-papers";
import { parseLiteratureSettings } from "@/lib/literature/server/parse";
import {
  listLiteraturePapers,
  saveLiteratureSettings,
  upsertAnalyzedPapers,
} from "@/lib/literature/server/repository";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  console.log("[literature] update request received");

  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const { settings } = parseLiteratureSettings(body, {
      requireEnabledSources: true,
    });

    console.log("[literature] discipline:", settings.discipline);
    console.log("[literature] selectedSources:", settings.selectedSources.join(", "));
    console.log("[literature] keywords:", settings.keywords);
    console.log("[literature] dateRangeDays:", settings.dateRangeDays);

    await saveLiteratureSettings(supabase, user.id, settings);

    const drafts = await fetchPapersFromSelectedSources(settings);

    console.log("[literature] papers fetched:", drafts.length);

    const analysisById = await analyzeArxivPapers(
      drafts,
      settings,
      request.signal,
    );

    console.log("[literature] papers analyzed:", analysisById.size);

    await upsertAnalyzedPapers(supabase, user.id, drafts, analysisById);

    const papers = await listLiteraturePapers(supabase, user.id);

    return Response.json({ settings, papers });
  } catch (error) {
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
