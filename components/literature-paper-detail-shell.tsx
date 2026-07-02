"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LiteraturePaperFolderSelector } from "@/components/literature-paper-folder-selector";
import { LITERATURE_PRIORITY_LABELS } from "@/lib/literature/constants";
import {
  fetchLiteratureFolders,
  fetchLiteraturePaper,
  LiteratureError,
  setPaperFolders,
  updateLiteraturePaperStatus,
} from "@/lib/literature/client";
import {
  formatLiteratureDate,
  getPaperDoi,
  getPaperDoiUrl,
  getPaperExternalId,
  getPaperJournalVenue,
  getPaperSource,
  getPaperTags,
  hasPaperPdfLink,
  literaturePriorityClassName,
} from "@/lib/literature/paper-display";
import type { LiteratureFolder, LiteraturePaper } from "@/lib/literature/types";

type LiteraturePaperDetailShellProps = {
  paperId: string;
};

export function LiteraturePaperDetailShell({
  paperId,
}: LiteraturePaperDetailShellProps) {
  const [paper, setPaper] = useState<LiteraturePaper | null>(null);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderSelectorMode, setFolderSelectorMode] = useState<
    "save" | "move" | null
  >(null);

  const folderNameById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [loaded, loadedFolders] = await Promise.all([
          fetchLiteraturePaper(paperId),
          fetchLiteratureFolders(),
        ]);
        if (!cancelled) {
          setPaper(loaded);
          setFolders(loadedFolders);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof LiteratureError
              ? err.message
              : "Failed to load paper.";
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
  }, [paperId]);

  const handleStatusChange = useCallback(
    async (status: "saved" | "skipped" | "read") => {
      if (!paper) {
        return;
      }

      setIsUpdating(true);
      setError(null);

      try {
        const updated = await updateLiteraturePaperStatus(paper.id, status);
        setPaper(updated);
      } catch (err) {
        const message =
          err instanceof LiteratureError
            ? err.message
            : "Failed to update paper status.";
        setError(message);
      } finally {
        setIsUpdating(false);
      }
    },
    [paper],
  );

  const handleSaveToFolders = useCallback(
    async (folderIds: string[]) => {
      if (!paper) {
        return;
      }

      const updated = await updateLiteraturePaperStatus(paper.id, "saved");
      const savedFolderIds = await setPaperFolders(paper.id, folderIds);
      setPaper({ ...updated, folderIds: savedFolderIds });
    },
    [paper],
  );

  const handleMoveToFolders = useCallback(
    async (folderIds: string[]) => {
      if (!paper) {
        return;
      }

      const savedFolderIds = await setPaperFolders(paper.id, folderIds);
      setPaper((current) => (current ? { ...current, folderIds: savedFolderIds } : current));
    },
    [paper],
  );

  const externalId = paper ? getPaperExternalId(paper) : null;
  const journalVenue = paper ? getPaperJournalVenue(paper) : null;
  const doi = paper ? getPaperDoi(paper) : null;
  const subjectTags = paper ? getPaperTags(paper) : [];
  const assignedFolderIds = paper?.folderIds ?? [];

  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-gray-100 px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Paper Detail</h1>
            <p className="text-sm text-gray-500">
              Literature Tracker paper overview and AI triage notes.
            </p>
          </div>
          <Link
            href="/literature/library"
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Open Library
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {error && (
          <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
            Loading paper...
          </div>
        ) : !paper ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Paper not found</p>
            <p className="mt-2 text-sm text-gray-500">
              This paper may have been removed or you may not have access to it.
            </p>
          </div>
        ) : (
          <article className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {paper.priority && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${literaturePriorityClassName(paper.priority)}`}
                  >
                    {LITERATURE_PRIORITY_LABELS[paper.priority]}
                  </span>
                )}
                {paper.relevanceScore !== null && (
                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    Relevance {paper.relevanceScore}
                  </span>
                )}
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                  {paper.status}
                </span>
              </div>

              <h2 className="text-2xl font-semibold leading-tight text-gray-900">
                {paper.title}
              </h2>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Authors
                  </dt>
                  <dd className="mt-1 text-sm text-gray-700">
                    {paper.authors.length > 0
                      ? paper.authors.join(", ")
                      : "Unknown authors"}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Source
                  </dt>
                  <dd className="mt-1 text-sm text-gray-700">{getPaperSource(paper)}</dd>
                </div>

                {journalVenue && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Journal / Venue
                    </dt>
                    <dd className="mt-1 text-sm text-gray-700">{journalVenue}</dd>
                  </div>
                )}

                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Published date
                  </dt>
                  <dd className="mt-1 text-sm text-gray-700">
                    {formatLiteratureDate(paper.publishedAt)}
                  </dd>
                </div>

                {doi && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      DOI
                    </dt>
                    <dd className="mt-1 text-sm text-gray-700">{doi}</dd>
                  </div>
                )}

                {externalId && (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {externalId.label}
                    </dt>
                    <dd className="mt-1 text-sm text-gray-700">{externalId.value}</dd>
                  </div>
                )}
              </dl>
            </div>

            <section>
              <h3 className="text-sm font-semibold text-gray-900">Abstract</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                {paper.abstract}
              </p>
            </section>

            {paper.chineseSummary && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900">
                  AI Chinese summary
                </h3>
                <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                    {paper.chineseSummary}
                  </pre>
                </div>
              </section>
            )}

            {paper.recommendationReason && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900">
                  Recommendation reason
                </h3>
                <p className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {paper.recommendationReason}
                </p>
              </section>
            )}

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Folders</h3>
                <button
                  type="button"
                  onClick={() => setFolderSelectorMode("move")}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                >
                  Move to Folder
                </button>
              </div>
              {assignedFolderIds.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  This paper is not in any folders yet.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {assignedFolderIds.map((folderId) => {
                    const name = folderNameById.get(folderId);
                    if (!name) {
                      return null;
                    }

                    return (
                      <span
                        key={folderId}
                        className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800"
                      >
                        {name}
                      </span>
                    );
                  })}
                </div>
              )}
            </section>

            {subjectTags.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-900">
                  Subject categories
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subjectTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-gray-900">External links</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={paper.absUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Abstract page
                </a>
                {hasPaperPdfLink(paper) && (
                  <a
                    href={paper.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    PDF page
                  </a>
                )}
                {doi && (
                  <a
                    href={getPaperDoiUrl(doi)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    DOI link
                  </a>
                )}
              </div>
            </section>

            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => setFolderSelectorMode("save")}
                className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save to Folder
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  void handleStatusChange("read");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Mark as read
              </button>
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => {
                  void handleStatusChange("skipped");
                }}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Skip
              </button>
              <Link
                href="/literature"
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Back to Literature Tracker
              </Link>
            </div>
          </article>
        )}
      </main>

      {folderSelectorMode && paper && (
        <LiteraturePaperFolderSelector
          title={folderSelectorMode === "save" ? "Save to Folder" : "Move to Folder"}
          description={
            folderSelectorMode === "save"
              ? "Choose one or more folders for this paper. It will be marked as saved."
              : "Add or remove folders for this paper."
          }
          confirmLabel={folderSelectorMode === "save" ? "Save to Folder" : "Save"}
          folders={folders}
          selectedFolderIds={assignedFolderIds}
          onClose={() => setFolderSelectorMode(null)}
          onConfirm={
            folderSelectorMode === "save" ? handleSaveToFolders : handleMoveToFolders
          }
        />
      )}
    </div>
  );
}
