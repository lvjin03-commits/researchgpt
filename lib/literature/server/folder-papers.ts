// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listPaperIdsInFolder,
  lookupLiteratureFolder,
} from "@/lib/literature/server/folder-repository";
import { listLiteraturePapers } from "@/lib/literature/server/repository";
import type { LiteraturePaper } from "@/lib/literature/types";

export async function listLiteratureFolderPapers(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  options?: { folderNameHint?: string },
): Promise<LiteraturePaper[]> {
  const folder = await lookupLiteratureFolder(
    supabase,
    userId,
    folderId,
    options,
  );

  const paperIds = await listPaperIdsInFolder(supabase, userId, folder.id);
  if (paperIds.length === 0) {
    return [];
  }

  const idSet = new Set(paperIds);
  const allPapers = await listLiteraturePapers(supabase, userId);

  return allPapers.filter((paper) => idSet.has(paper.id));
}

export type ReviewFolderPaperLoadLog = {
  folderId: string;
  resolvedFolderId: string;
  folderName: string;
  folderLinkCount: number;
  loadedPaperCount: number;
  sampleTitles: string[];
};

export async function loadReviewFolderPapersWithLog(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  options?: { folderNameHint?: string },
): Promise<{ papers: LiteraturePaper[]; log: ReviewFolderPaperLoadLog }> {
  const folder = await lookupLiteratureFolder(
    supabase,
    userId,
    folderId,
    options,
  );
  const paperIds = await listPaperIdsInFolder(supabase, userId, folder.id);

  let papers: LiteraturePaper[] = [];
  if (paperIds.length > 0) {
    const idSet = new Set(paperIds);
    const allPapers = await listLiteraturePapers(supabase, userId);
    papers = allPapers.filter((paper) => idSet.has(paper.id));
  }

  return {
    papers,
    log: {
      folderId,
      resolvedFolderId: folder.id,
      folderName: folder.name,
      folderLinkCount: paperIds.length,
      loadedPaperCount: papers.length,
      sampleTitles: papers.slice(0, 5).map((paper) => paper.title),
    },
  };
}
