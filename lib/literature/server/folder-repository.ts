// Server-only module.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import type { LiteratureFolder } from "@/lib/literature/types";

const LITERATURE_DIR = path.join(os.tmpdir(), "researchgpt-literature");

type FolderLinkRecord = {
  id: string;
  paperId: string;
  folderId: string;
  createdAt: string;
};

type FolderStore = {
  folders: LiteratureFolder[];
  links: FolderLinkRecord[];
};

type DbFolderRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

function folderStorePath(userId: string): string {
  return path.join(LITERATURE_DIR, `${userId}-folders.json`);
}

function isMissingFolderTableError(error: {
  message?: string;
  code?: string;
}): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("literature_folders") ||
    message.includes("literature_folder_papers") ||
    message.includes("does not exist")
  );
}

function mapFolderRow(row: DbFolderRow): LiteratureFolder {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readFolderStore(userId: string): Promise<FolderStore> {
  try {
    const raw = await fs.readFile(folderStorePath(userId), "utf8");
    const parsed = JSON.parse(raw) as FolderStore;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
    };
  } catch {
    return { folders: [], links: [] };
  }
}

async function writeFolderStore(userId: string, store: FolderStore): Promise<void> {
  await fs.mkdir(LITERATURE_DIR, { recursive: true });
  await fs.writeFile(folderStorePath(userId), JSON.stringify(store, null, 2), "utf8");
}

export async function listLiteratureFolders(
  supabase: SupabaseClient,
  userId: string,
): Promise<LiteratureFolder[]> {
  const { data, error } = await supabase
    .from("literature_folders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingFolderTableError(error)) {
      const store = await readFolderStore(userId);
      return store.folders;
    }

    throw new LiteratureError(error.message, 500);
  }

  return ((data ?? []) as DbFolderRow[]).map(mapFolderRow);
}

export async function createLiteratureFolder(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<LiteratureFolder> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LiteratureError("Folder name is required.", 400);
  }

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("literature_folders")
    .insert({ user_id: userId, name: trimmed, updated_at: now })
    .select("*")
    .single();

  if (error) {
    if (isMissingFolderTableError(error)) {
      const store = await readFolderStore(userId);
      if (
        store.folders.some(
          (folder) => folder.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw new LiteratureError("Folder name already exists.", 409);
      }

      const created: LiteratureFolder = {
        id: randomUUID(),
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      };
      store.folders.push(created);
      await writeFolderStore(userId, store);
      return created;
    }

    if (error.code === "23505") {
      throw new LiteratureError("Folder name already exists.", 409);
    }

    throw new LiteratureError(error.message, 500);
  }

  return mapFolderRow(data as DbFolderRow);
}

export async function updateLiteratureFolder(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  name: string,
): Promise<LiteratureFolder> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LiteratureError("Folder name is required.", 400);
  }

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("literature_folders")
    .update({ name: trimmed, updated_at: now })
    .eq("user_id", userId)
    .eq("id", folderId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingFolderTableError(error)) {
      const store = await readFolderStore(userId);
      const index = store.folders.findIndex((folder) => folder.id === folderId);

      if (index === -1) {
        throw new LiteratureError("Folder not found.", 404);
      }

      store.folders[index] = {
        ...store.folders[index],
        name: trimmed,
        updatedAt: now,
      };
      await writeFolderStore(userId, store);
      return store.folders[index];
    }

    if (error.code === "23505") {
      throw new LiteratureError("Folder name already exists.", 409);
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Folder not found.", 404);
  }

  return mapFolderRow(data as DbFolderRow);
}

export async function deleteLiteratureFolder(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<void> {
  const { error } = await supabase
    .from("literature_folders")
    .delete()
    .eq("user_id", userId)
    .eq("id", folderId);

  if (error) {
    if (isMissingFolderTableError(error)) {
      const store = await readFolderStore(userId);
      const index = store.folders.findIndex((folder) => folder.id === folderId);

      if (index === -1) {
        throw new LiteratureError("Folder not found.", 404);
      }

      store.folders.splice(index, 1);
      store.links = store.links.filter((link) => link.folderId !== folderId);
      await writeFolderStore(userId, store);
      return;
    }

    throw new LiteratureError(error.message, 500);
  }
}

export async function getPaperFolderIdsMap(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("literature_folder_papers")
    .select("paper_id, folder_id")
    .eq("user_id", userId);

  if (error) {
    if (isMissingFolderTableError(error)) {
      const store = await readFolderStore(userId);
      const map = new Map<string, string[]>();

      for (const link of store.links) {
        const current = map.get(link.paperId) ?? [];
        current.push(link.folderId);
        map.set(link.paperId, current);
      }

      return map;
    }

    throw new LiteratureError(error.message, 500);
  }

  const map = new Map<string, string[]>();

  for (const row of (data ?? []) as Array<{
    paper_id: string;
    folder_id: string;
  }>) {
    const current = map.get(row.paper_id) ?? [];
    current.push(row.folder_id);
    map.set(row.paper_id, current);
  }

  return map;
}

export async function getPaperFolderIds(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
): Promise<string[]> {
  const map = await getPaperFolderIdsMap(supabase, userId);
  return map.get(paperId) ?? [];
}

export async function setPaperFolderIds(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  folderIds: string[],
): Promise<string[]> {
  const uniqueFolderIds = [...new Set(folderIds)];

  const folders = await listLiteratureFolders(supabase, userId);
  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const invalid = uniqueFolderIds.filter((id) => !validFolderIds.has(id));

  if (invalid.length > 0) {
    throw new LiteratureError(`Unknown folder id(s): ${invalid.join(", ")}.`, 400);
  }

  const { error: deleteError } = await supabase
    .from("literature_folder_papers")
    .delete()
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  if (deleteError) {
    if (isMissingFolderTableError(deleteError)) {
      const store = await readFolderStore(userId);
      store.links = store.links.filter((link) => link.paperId !== paperId);

      for (const folderId of uniqueFolderIds) {
        store.links.push({
          id: randomUUID(),
          paperId,
          folderId,
          createdAt: new Date().toISOString(),
        });
      }

      await writeFolderStore(userId, store);
      return uniqueFolderIds;
    }

    throw new LiteratureError(deleteError.message, 500);
  }

  if (uniqueFolderIds.length === 0) {
    return [];
  }

  const rows = uniqueFolderIds.map((folderId) => ({
    user_id: userId,
    paper_id: paperId,
    folder_id: folderId,
  }));

  const { error: insertError } = await supabase
    .from("literature_folder_papers")
    .insert(rows);

  if (insertError) {
    throw new LiteratureError(insertError.message, 500);
  }

  return uniqueFolderIds;
}
