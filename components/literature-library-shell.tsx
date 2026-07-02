"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LiteraturePaperCard } from "@/components/literature-paper-card";
import {
  fetchLiteratureLibrary,
  LiteratureError,
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
import type { LiteraturePaper, LiteraturePaperStatus } from "@/lib/literature/types";

const DEFAULT_FILTERS: LibraryFilters = {
  status: "saved",
  q: "",
  source: "",
  discipline: "",
  priority: "",
};

export function LiteratureLibraryShell() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await fetchLiteratureLibrary(filters);
        if (!cancelled) {
          setPapers(result.papers);
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

        if (filters.status !== "all" && status !== filters.status) {
          return updated.filter((paper) => paper.id !== paperId);
        }

        return updated;
      });
    },
    [filters.status],
  );

  const setStatusTab = (status: LibraryStatusTab) => {
    setFilters((current) => ({ ...current, status }));
  };

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
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

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {LIBRARY_STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatusTab(tab.value)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  filters.status === tab.value
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

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
                onStatusChange={handleStatusChange}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
