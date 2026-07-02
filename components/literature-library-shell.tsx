"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LiteraturePaperCard } from "@/components/literature-paper-card";
import {
  createLiteratureCategory,
  deleteLiteratureCategory,
  fetchLiteratureLibrary,
  LiteratureError,
  updateLiteratureCategory,
  updateLiteraturePaperStatus,
} from "@/lib/literature/client";
import {
  LIBRARY_PRIORITY_OPTIONS,
  LIBRARY_SOURCE_OPTIONS,
  LIBRARY_STATUS_TABS,
  type LibraryFilters,
  type LibraryStatusTab,
} from "@/lib/literature/library-filters";
import { LITERATURE_DISCIPLINES } from "@/lib/literature/source-taxonomy";
import type {
  LiteratureCategory,
  LiteraturePaper,
  LiteraturePaperStatus,
} from "@/lib/literature/types";

const DEFAULT_FILTERS: LibraryFilters = {
  status: "saved",
  q: "",
  source: "",
  discipline: "",
  priority: "",
  customCategoryId: "",
};

export function LiteratureLibraryShell() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [categories, setCategories] = useState<LiteratureCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [categoryActionError, setCategoryActionError] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchLiteratureLibrary(filters);
        if (!cancelled) {
          setPapers(result.papers);
          setCategories(result.categories);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof LiteratureError
              ? err.message
              : "Failed to load literature library.";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const handleStatusChange = useCallback(
    async (paperId: string, status: LiteraturePaperStatus) => {
      await updateLiteraturePaperStatus(paperId, status);
      setPapers((current) => {
        const updated = current.map((paper) =>
          paper.id === paperId ? { ...paper, status } : paper,
        );

        if (status === "new") {
          return updated.filter((paper) => paper.id !== paperId);
        }

        if (
          !filters.customCategoryId &&
          filters.status !== "all" &&
          status !== filters.status
        ) {
          return updated.filter((paper) => paper.id !== paperId);
        }

        return updated;
      });
    },
    [filters.customCategoryId, filters.status],
  );

  const handlePaperCategoriesChange = useCallback(
    (paperId: string, categoryIds: string[]) => {
      setPapers((current) => {
        const updated = current.map((paper) =>
          paper.id === paperId ? { ...paper, customCategoryIds: categoryIds } : paper,
        );

        if (
          filters.customCategoryId &&
          !categoryIds.includes(filters.customCategoryId)
        ) {
          return updated.filter((paper) => paper.id !== paperId);
        }

        return updated;
      });
    },
    [filters.customCategoryId],
  );

  const setStatusTab = (status: LibraryStatusTab) => {
    setFilters((current) => ({
      ...current,
      status,
      customCategoryId: "",
    }));
  };

  const selectCustomCategory = (categoryId: string) => {
    setFilters((current) => ({
      ...current,
      customCategoryId: categoryId,
    }));
  };

  const handleCreateCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      return;
    }

    setIsCreatingCategory(true);
    setCategoryActionError(null);

    try {
      const created = await createLiteratureCategory(trimmed);
      setCategories((current) => [...current, created]);
      setNewCategoryName("");
    } catch (err) {
      setCategoryActionError(
        err instanceof LiteratureError ? err.message : "Failed to create category.",
      );
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const startEditingCategory = (category: LiteratureCategory) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setCategoryActionError(null);
  };

  const cancelEditingCategory = () => {
    setEditingCategoryId(null);
    setEditingCategoryName("");
  };

  const handleRenameCategory = async (categoryId: string) => {
    const trimmed = editingCategoryName.trim();
    if (!trimmed) {
      return;
    }

    setCategoryActionError(null);

    try {
      const updated = await updateLiteratureCategory(categoryId, trimmed);
      setCategories((current) =>
        current.map((category) => (category.id === categoryId ? updated : category)),
      );
      cancelEditingCategory();
    } catch (err) {
      setCategoryActionError(
        err instanceof LiteratureError ? err.message : "Failed to rename category.",
      );
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!window.confirm("Delete this category? Papers will keep their other categories.")) {
      return;
    }

    setCategoryActionError(null);

    try {
      await deleteLiteratureCategory(categoryId);
      setCategories((current) => current.filter((category) => category.id !== categoryId));

      if (filters.customCategoryId === categoryId) {
        setFilters((current) => ({ ...current, customCategoryId: "" }));
      } else {
        setPapers((current) =>
          current.map((paper) => ({
            ...paper,
            customCategoryIds: (paper.customCategoryIds ?? []).filter(
              (id) => id !== categoryId,
            ),
          })),
        );
      }

      if (editingCategoryId === categoryId) {
        cancelEditingCategory();
      }
    } catch (err) {
      setCategoryActionError(
        err instanceof LiteratureError ? err.message : "Failed to delete category.",
      );
    }
  };

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Literature Library</h1>
            <p className="text-sm text-gray-500">
              Browse saved, read, and skipped papers from your literature tracker.
            </p>
          </div>
          <Link
            href="/literature"
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Back to Literature Tracker
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 lg:flex-row lg:items-start lg:px-6">
        <aside className="w-full shrink-0 space-y-6 lg:w-64">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Status
            </h2>
            <ul className="mt-3 space-y-1">
              {LIBRARY_STATUS_TABS.map((tab) => {
                const isActive =
                  !filters.customCategoryId && filters.status === tab.value;

                return (
                  <li key={tab.value}>
                    <button
                      type="button"
                      onClick={() => setStatusTab(tab.value)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-gray-900 text-white"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {tab.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              My Categories
            </h2>

            {categories.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">No custom categories yet.</p>
            ) : (
              <ul className="mt-3 space-y-1">
                {categories.map((category) => {
                  const isActive = filters.customCategoryId === category.id;
                  const isEditing = editingCategoryId === category.id;

                  return (
                    <li key={category.id}>
                      {isEditing ? (
                        <div className="space-y-2 rounded-lg border border-gray-200 p-2">
                          <input
                            type="text"
                            value={editingCategoryName}
                            onChange={(event) =>
                              setEditingCategoryName(event.target.value)
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                          />
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                void handleRenameCategory(category.id);
                              }}
                              className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEditingCategory}
                              className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => selectCustomCategory(category.id)}
                            className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                              isActive
                                ? "bg-blue-600 text-white"
                                : "text-gray-700 hover:bg-gray-100"
                            }`}
                          >
                            <span className="block truncate">{category.name}</span>
                          </button>
                          <button
                            type="button"
                            aria-label={`Rename ${category.name}`}
                            onClick={() => startEditingCategory(category)}
                            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${category.name}`}
                            onClick={() => {
                              void handleDeleteCategory(category.id);
                            }}
                            className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                          >
                            Del
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 space-y-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="New category name"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCreateCategory();
                  }
                }}
              />
              <button
                type="button"
                disabled={isCreatingCategory || !newCategoryName.trim()}
                onClick={() => {
                  void handleCreateCategory();
                }}
                className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingCategory ? "Creating..." : "Create Category"}
              </button>
            </div>

            {categoryActionError && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {categoryActionError}
              </p>
            )}
          </section>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <label
                htmlFor="library-search"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Search
              </label>
              <input
                id="library-search"
                type="search"
                value={filters.q}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
                placeholder="Search title, author, or abstract"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="library-source"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Source
                </label>
                <select
                  id="library-source"
                  value={filters.source}
                  onChange={(event) =>
                    setFilters((current) => ({ ...current, source: event.target.value }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                >
                  {LIBRARY_SOURCE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="library-discipline"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Discipline
                </label>
                <select
                  id="library-discipline"
                  value={filters.discipline}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      discipline: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                >
                  <option value="">All disciplines</option>
                  {LITERATURE_DISCIPLINES.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="library-priority"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Priority
                </label>
                <select
                  id="library-priority"
                  value={filters.priority}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      priority: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                >
                  {LIBRARY_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {isLoading ? (
            <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
              Loading literature library...
            </div>
          ) : papers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
              <p className="text-sm font-medium text-gray-900">No papers found</p>
              <p className="mt-2 text-sm text-gray-500">
                Try another tab or adjust your search and filters.
              </p>
            </div>
          ) : (
            <section className="space-y-4">
              {papers.map((paper) => (
                <LiteraturePaperCard
                  key={paper.id}
                  paper={paper}
                  variant="library"
                  categories={categories}
                  onStatusChange={handleStatusChange}
                  onCategoriesChange={handlePaperCategoriesChange}
                />
              ))}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
