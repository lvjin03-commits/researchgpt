// Server-only module.

import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LiteratureError } from "@/lib/literature/errors";
import type { LiteratureCategory } from "@/lib/literature/types";

const LITERATURE_DIR = path.join(os.tmpdir(), "researchgpt-literature");

type CategoryLinkRecord = {
  id: string;
  paperId: string;
  categoryId: string;
  createdAt: string;
};

type CategoryStore = {
  categories: LiteratureCategory[];
  links: CategoryLinkRecord[];
};

type DbCategoryRow = {
  id: string;
  name: string;
  created_at: string;
};

type DbPaperCategoryRow = {
  id: string;
  paper_id: string;
  category_id: string;
  created_at: string;
};

function categoryStorePath(userId: string): string {
  return path.join(LITERATURE_DIR, `${userId}-categories.json`);
}

function isMissingCategoryTableError(error: {
  message?: string;
  code?: string;
}): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("literature_categories") ||
    message.includes("literature_paper_categories") ||
    message.includes("does not exist")
  );
}

function mapCategoryRow(row: DbCategoryRow): LiteratureCategory {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

async function readCategoryStore(userId: string): Promise<CategoryStore> {
  try {
    const raw = await fs.readFile(categoryStorePath(userId), "utf8");
    const parsed = JSON.parse(raw) as CategoryStore;
    return {
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
    };
  } catch {
    return { categories: [], links: [] };
  }
}

async function writeCategoryStore(
  userId: string,
  store: CategoryStore,
): Promise<void> {
  await fs.mkdir(LITERATURE_DIR, { recursive: true });
  await fs.writeFile(
    categoryStorePath(userId),
    JSON.stringify(store, null, 2),
    "utf8",
  );
}

export async function listLiteratureCategories(
  supabase: SupabaseClient,
  userId: string,
): Promise<LiteratureCategory[]> {
  const { data, error } = await supabase
    .from("literature_categories")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingCategoryTableError(error)) {
      const store = await readCategoryStore(userId);
      return store.categories;
    }

    throw new LiteratureError(error.message, 500);
  }

  return ((data ?? []) as DbCategoryRow[]).map(mapCategoryRow);
}

export async function createLiteratureCategory(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<LiteratureCategory> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LiteratureError("Category name is required.", 400);
  }

  const { data, error } = await supabase
    .from("literature_categories")
    .insert({ user_id: userId, name: trimmed })
    .select("*")
    .single();

  if (error) {
    if (isMissingCategoryTableError(error)) {
      const store = await readCategoryStore(userId);
      if (
        store.categories.some(
          (category) => category.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw new LiteratureError("Category name already exists.", 409);
      }

      const created: LiteratureCategory = {
        id: randomUUID(),
        name: trimmed,
        createdAt: new Date().toISOString(),
      };
      store.categories.push(created);
      await writeCategoryStore(userId, store);
      return created;
    }

    if (error.code === "23505") {
      throw new LiteratureError("Category name already exists.", 409);
    }

    throw new LiteratureError(error.message, 500);
  }

  return mapCategoryRow(data as DbCategoryRow);
}

export async function updateLiteratureCategory(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
  name: string,
): Promise<LiteratureCategory> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new LiteratureError("Category name is required.", 400);
  }

  const { data, error } = await supabase
    .from("literature_categories")
    .update({ name: trimmed })
    .eq("user_id", userId)
    .eq("id", categoryId)
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingCategoryTableError(error)) {
      const store = await readCategoryStore(userId);
      const index = store.categories.findIndex(
        (category) => category.id === categoryId,
      );

      if (index === -1) {
        throw new LiteratureError("Category not found.", 404);
      }

      store.categories[index] = {
        ...store.categories[index],
        name: trimmed,
      };
      await writeCategoryStore(userId, store);
      return store.categories[index];
    }

    if (error.code === "23505") {
      throw new LiteratureError("Category name already exists.", 409);
    }

    throw new LiteratureError(error.message, 500);
  }

  if (!data) {
    throw new LiteratureError("Category not found.", 404);
  }

  return mapCategoryRow(data as DbCategoryRow);
}

export async function deleteLiteratureCategory(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
): Promise<void> {
  const { error } = await supabase
    .from("literature_categories")
    .delete()
    .eq("user_id", userId)
    .eq("id", categoryId);

  if (error) {
    if (isMissingCategoryTableError(error)) {
      const store = await readCategoryStore(userId);
      const index = store.categories.findIndex(
        (category) => category.id === categoryId,
      );

      if (index === -1) {
        throw new LiteratureError("Category not found.", 404);
      }

      store.categories.splice(index, 1);
      store.links = store.links.filter((link) => link.categoryId !== categoryId);
      await writeCategoryStore(userId, store);
      return;
    }

    throw new LiteratureError(error.message, 500);
  }
}

export async function getPaperCategoryIdsMap(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("literature_paper_categories")
    .select("paper_id, category_id")
    .eq("user_id", userId);

  if (error) {
    if (isMissingCategoryTableError(error)) {
      const store = await readCategoryStore(userId);
      const map = new Map<string, string[]>();

      for (const link of store.links) {
        const current = map.get(link.paperId) ?? [];
        current.push(link.categoryId);
        map.set(link.paperId, current);
      }

      return map;
    }

    throw new LiteratureError(error.message, 500);
  }

  const map = new Map<string, string[]>();

  for (const row of (data ?? []) as Array<{
    paper_id: string;
    category_id: string;
  }>) {
    const current = map.get(row.paper_id) ?? [];
    current.push(row.category_id);
    map.set(row.paper_id, current);
  }

  return map;
}

export async function setPaperCategoryIds(
  supabase: SupabaseClient,
  userId: string,
  paperId: string,
  categoryIds: string[],
): Promise<string[]> {
  const uniqueCategoryIds = [...new Set(categoryIds)];

  const categories = await listLiteratureCategories(supabase, userId);
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const invalid = uniqueCategoryIds.filter((id) => !validCategoryIds.has(id));

  if (invalid.length > 0) {
    throw new LiteratureError(
      `Unknown category id(s): ${invalid.join(", ")}.`,
      400,
    );
  }

  const { error: deleteError } = await supabase
    .from("literature_paper_categories")
    .delete()
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  if (deleteError) {
    if (isMissingCategoryTableError(deleteError)) {
      const store = await readCategoryStore(userId);
      store.links = store.links.filter((link) => link.paperId !== paperId);

      for (const categoryId of uniqueCategoryIds) {
        store.links.push({
          id: randomUUID(),
          paperId,
          categoryId,
          createdAt: new Date().toISOString(),
        });
      }

      await writeCategoryStore(userId, store);
      return uniqueCategoryIds;
    }

    throw new LiteratureError(deleteError.message, 500);
  }

  if (uniqueCategoryIds.length === 0) {
    return [];
  }

  const rows = uniqueCategoryIds.map((categoryId) => ({
    user_id: userId,
    paper_id: paperId,
    category_id: categoryId,
  }));

  const { error: insertError } = await supabase
    .from("literature_paper_categories")
    .insert(rows);

  if (insertError) {
    throw new LiteratureError(insertError.message, 500);
  }

  return uniqueCategoryIds;
}
