import { LiteratureError } from "@/lib/literature/errors";
import { AIProviderError } from "@/lib/ai/errors";
import { getPaperFolderIds } from "@/lib/literature/server/folder-repository";
import { ensureLiteraturePaperFullText } from "@/lib/literature/server/pdf-archive";
import {
  getLiteraturePaperById,
  saveLiteraturePaperWorkspaceAnalysis,
  stripLiteraturePaperFullTextForResponse,
} from "@/lib/literature/server/repository";
import {
  generatePaperWorkspaceAnalysis,
  resolvePaperWorkspaceAnalysis,
} from "@/lib/literature/server/workspace-service";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const paper = await getLiteraturePaperById(supabase, user.id, id);
    const workspaceAnalysis = resolvePaperWorkspaceAnalysis(paper);

    return Response.json({ workspaceAnalysis });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] GET paper workspace failed:", error);
    return Response.json({ error: "Failed to load paper workspace." }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const refresh = searchParams.get("refresh") === "true";
    const requireFullText = searchParams.get("depth") === "full";

    let paper = await getLiteraturePaperById(supabase, user.id, id);

    if (requireFullText && !paper.fullText?.trim()) {
      paper = await ensureLiteraturePaperFullText(supabase, user.id, paper);
    }

    if (
      !refresh &&
      paper.workspaceAnalysis &&
      (!requireFullText || paper.workspaceAnalysis.evidenceLevel === "full_text")
    ) {
      const folderIds = await getPaperFolderIds(supabase, user.id, id);
      return Response.json({
        paper: stripLiteraturePaperFullTextForResponse({ ...paper, folderIds }),
        workspaceAnalysis: paper.workspaceAnalysis,
      });
    }

    const workspaceAnalysis = await generatePaperWorkspaceAnalysis(
      paper,
      request.signal,
      { requireFullText },
    );
    const updated = await saveLiteraturePaperWorkspaceAnalysis(
      supabase,
      user.id,
      id,
      workspaceAnalysis,
    );
    const folderIds = await getPaperFolderIds(supabase, user.id, id);

    return Response.json({
      paper: stripLiteraturePaperFullTextForResponse({ ...updated, folderIds }),
      workspaceAnalysis,
    });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    if (error instanceof AIProviderError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] POST paper workspace failed:", error);
    return Response.json(
      { error: "Failed to generate paper workspace analysis." },
      { status: 500 },
    );
  }
}
