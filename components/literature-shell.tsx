"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LiteraturePaperCard } from "@/components/literature-paper-card";
import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_DATE_RANGE_OPTIONS,
} from "@/lib/literature/constants";
import {
  fetchLiteratureState,
  LiteratureError,
  updateLiteraturePaperStatus,
  updateLiteraturePapers,
} from "@/lib/literature/client";
import { normalizeLiteratureSettings } from "@/lib/literature/normalize-settings";
import {
  DEFAULT_LITERATURE_DISCIPLINE,
  getDefaultSelectedSources,
  getDisciplineSources,
  isSourceAvailable,
  LITERATURE_DISCIPLINES,
} from "@/lib/literature/source-taxonomy";
import type { LiteratureDisciplineId } from "@/lib/literature/source-taxonomy";
import type {
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
} from "@/lib/literature/types";

const DEFAULT_SETTINGS: LiteratureSettings = normalizeLiteratureSettings({
  discipline: DEFAULT_LITERATURE_DISCIPLINE,
  selectedSources: ["arxiv"],
  dateRangeDays: LITERATURE_DATE_RANGE_DAYS,
});

export function LiteratureShell() {
  const [settings, setSettings] = useState<LiteratureSettings>(DEFAULT_SETTINGS);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const state = await fetchLiteratureState();
        if (!cancelled) {
          setSettings(state.settings);
          setPapers(state.papers);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof LiteratureError
              ? err.message
              : "Failed to load literature tracker.";
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
  }, []);

  const handleUpdatePapers = useCallback(async () => {
    setIsUpdating(true);
    setError(null);
    setStatusMessage(null);

    try {
      const result = await updateLiteraturePapers(settings);
      setSettings(result.settings);
      setPapers(result.papers);
      setStatusMessage(`Updated ${result.papers.length} paper(s).`);
    } catch (err) {
      const detail =
        err instanceof LiteratureError
          ? err.message
          : "Failed to update literature papers.";
      setError(`Update failed. Showing previous results. ${detail}`);
    } finally {
      setIsUpdating(false);
    }
  }, [settings]);

  const handleStatusChange = useCallback(
    async (paperId: string, status: LiteraturePaperStatus) => {
      const updated = await updateLiteraturePaperStatus(paperId, status);
      setPapers((current) =>
        current.map((paper) => (paper.id === updated.id ? updated : paper)),
      );
    },
    [],
  );

  const visiblePapers = papers.filter((paper) => paper.status !== "skipped");

  const fetchableSelectedSources = useMemo(
    () => settings.selectedSources.filter((sourceId) => isSourceAvailable(sourceId)),
    [settings.selectedSources],
  );

  const canUpdate =
    settings.keywords.trim().length > 0 && fetchableSelectedSources.length > 0;

  const handleDisciplineChange = (discipline: LiteratureDisciplineId) => {
    setSettings((current) => ({
      ...current,
      discipline,
      selectedSources: getDefaultSelectedSources(discipline),
    }));
  };

  const handleSourceToggle = (sourceId: string, available: boolean) => {
    if (!available) {
      return;
    }

    setSettings((current) => ({
      ...current,
      selectedSources: current.selectedSources.includes(sourceId)
        ? current.selectedSources.filter((item) => item !== sourceId)
        : [...current.selectedSources, sourceId],
    }));
  };

  const disciplineSources = getDisciplineSources(settings.discipline);

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              Literature Tracker
            </h1>
            <p className="text-sm text-gray-500">
              Select a discipline and sources to track recent papers with AI relevance scoring.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/literature/library"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Library
            </Link>
            <Link
              href="/chat"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Back to Chat
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <label
                htmlFor="research-direction"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Research direction
              </label>
              <textarea
                id="research-direction"
                rows={3}
                value={settings.researchDirection}
                disabled={isUpdating}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    researchDirection: event.target.value,
                  }))
                }
                placeholder="e.g. protein structure prediction with diffusion models"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="keywords"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Keywords
              </label>
              <input
                id="keywords"
                type="text"
                value={settings.keywords}
                disabled={isUpdating}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    keywords: event.target.value,
                  }))
                }
                placeholder="diffusion, protein folding, structure prediction"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="exclude-keywords"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Exclude keywords
              </label>
              <input
                id="exclude-keywords"
                type="text"
                value={settings.excludeKeywords}
                disabled={isUpdating}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    excludeKeywords: event.target.value,
                  }))
                }
                placeholder="survey, review"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="discipline"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Discipline
              </label>
              <select
                id="discipline"
                value={settings.discipline}
                disabled={isUpdating}
                onChange={(event) =>
                  handleDisciplineChange(event.target.value as LiteratureDisciplineId)
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50"
              >
                {LITERATURE_DISCIPLINES.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700">Sources</p>
                <p className="mt-1 text-xs text-gray-500">
                  arXiv and PubMed are available for fetching. Other sources are coming soon.
                </p>
              </div>

              <ul className="space-y-2">
                {disciplineSources.map((source) => {
                  const available = source.status === "available";

                  return (
                    <li key={source.id}>
                      <label
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                          available
                            ? "border-gray-200 bg-white text-gray-900"
                            : "border-gray-100 bg-gray-50 text-gray-500"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={settings.selectedSources.includes(source.id)}
                          disabled={!available || isUpdating}
                          onChange={() => handleSourceToggle(source.id, available)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{source.name}</span>
                          {!available && (
                            <span className="mt-0.5 block text-xs text-gray-400">
                              Coming soon
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              {fetchableSelectedSources.length === 0 && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  No fetchable sources for this discipline yet. Select a discipline with arXiv
                  to update papers.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="date-range"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Date range
              </label>
              <select
                id="date-range"
                value={settings.dateRangeDays}
                disabled={isUpdating}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    dateRangeDays: Number(event.target.value),
                  }))
                }
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50"
              >
                {LITERATURE_DATE_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              disabled={isUpdating || !canUpdate}
              onClick={() => {
                void handleUpdatePapers();
              }}
              className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
            >
              {isUpdating ? "Updating Papers..." : "Update Papers"}
            </button>
          </section>

          <section className="space-y-4">
            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            {statusMessage && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {statusMessage}
              </p>
            )}

            {isLoading ? (
              <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
                Loading literature tracker...
              </div>
            ) : visiblePapers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
                <p className="text-sm font-medium text-gray-900">No papers yet</p>
                <p className="mt-2 text-sm text-gray-500">
                  Choose a discipline, select arXiv, enter keywords, and click Update Papers.
                </p>
              </div>
            ) : (
              visiblePapers.map((paper) => (
                <LiteraturePaperCard
                  key={paper.id}
                  paper={paper}
                  variant="tracker"
                  onStatusChange={handleStatusChange}
                />
              ))
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
