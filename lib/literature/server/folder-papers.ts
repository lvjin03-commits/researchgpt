// Server-only module.

import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import {
  listLiteratureFolders,
  listPaperIdsInFolder,
} from "@/lib/literature/server/folder-repository";
import { listLiteraturePapers } from "@/lib/literature/server/repository";
import type { LiteraturePaper } from "@/lib/literature/types";

export async function listLiteratureFolderPapers(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<LiteraturePaper[]> {
  const folders = await listLiteratureFolders(supabase, userId);
  if (!folders.some((folder) => folder.id === folderId)) {
    throw new LiteratureError("文献夹不存在。", 404);
  }

  const paperIds = await listPaperIdsInFolder(supabase, userId, folderId);
  if (paperIds.length === 0) {
    return [];
  }

  const idSet = new Set(paperIds);
  const allPapers = await listLiteraturePapers(supabase, userId);

  return allPapers.filter((paper) => idSet.has(paper.id));
}

export type ReviewFolderPaperLoadLog = {
  folderId: string;
  folderLinkCount: number;
  loadedPaperCount: number;
  sampleTitles: string[];
};

export async function loadReviewFolderPapersWithLog(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<{ papers: LiteraturePaper[]; log: ReviewFolderPaperLoadLog }> {
  const paperIds = await listPaperIdsInFolder(supabase, userId, folderId);
  const papers = await listLiteratureFolderPapers(supabase, userId, folderId);

  return {
    papers,
    log: {
      folderId,
      folderLinkCount: paperIds.length,
      loadedPaperCount: papers.length,
      sampleTitles: papers.slice(0, 5).map((paper) => paper.title),
    },
  };
}
