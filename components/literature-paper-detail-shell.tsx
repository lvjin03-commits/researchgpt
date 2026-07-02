"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiteraturePaperFolderSelector } from "@/components/literature-paper-folder-selector";
import { LITERATURE_PRIORITY_LABELS } from "@/lib/literature/constants";
import {
  fetchLiteratureFolders,
  fetchLiteraturePaper,
  generateLiteraturePaperWorkspace,
  LiteratureError,
  setPaperFolders,
  updateLiteraturePaperNotes,
  updateLiteraturePaperStatus,
} from "@/lib/literature/client";
import {
  generateApaCitation,
  generateBibTeX,
  generatePaperMarkdown,
  generateRIS,
} from "@/lib/literature/paper-export";
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
import {
  getGoogleScholarUrl,
  getSemanticScholarUrl,
  scoreBarWidth,
} from "@/lib/literature/paper-workspace-display";
import type {
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
  PaperWorkspaceAnalysis,
} from "@/lib/literature/types";
import { deriveWorkspaceAnalysisFromPaper } from "@/lib/literature/paper-workspace-display";

type LiteraturePaperDetailShellProps = {
  paperId: string;
};

function WorkspaceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-gray-700">{value}</dd>
    </div>
  );
}

function AnalysisField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-gray-900">{label}</h3>
      <p className="mt-1 text-sm leading-relaxed text-gray-700">{value}</p>
    </div>
  );
}

function ScoreRow({ label, score }: { label: string; score: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">{score}/5</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-blue-600 transition-all"
          style={{ width: scoreBarWidth(score) }}
        />
      </div>
    </div>
  );
}

function ExportButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
    >
      {label}
    </button>
  );
}

function PlaceholderButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="cursor-not-allowed rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm font-medium text-gray-400"
    >
      {label}
    </button>
  );
}

export function LiteraturePaperDetailShell({
  paperId,
}: LiteraturePaperDetailShellProps) {
  const [paper, setPaper] = useState<LiteraturePaper | null>(null);
  const [workspace, setWorkspace] = useState<PaperWorkspaceAnalysis | null>(null);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [notes, setNotes] = useState("");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isGeneratingWorkspace, setIsGeneratingWorkspace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [folderSelectorMode, setFolderSelectorMode] = useState<
    "save" | "move" | null
  >(null);
  const notesDebounceRef = useRef<number | null>(null);

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
          setWorkspace(loaded.workspaceAnalysis ?? deriveWorkspaceAnalysisFromPaper(loaded));
          setNotes(loaded.personalNotes ?? "");
          setFolders(loadedFolders);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof LiteratureError ? err.message : "Failed to load paper.",
          );
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

  useEffect(() => {
    if (!paper || paper.workspaceAnalysis) {
      return;
    }

    let cancelled = false;
    setIsGeneratingWorkspace(true);

    void (async () => {
      try {
        const result = await generateLiteraturePaperWorkspace(paper.id);
        if (!cancelled) {
          setPaper(result.paper);
          setWorkspace(result.workspaceAnalysis);
        }
      } catch {
        // Keep derived workspace preview on failure.
      } finally {
        if (!cancelled) {
          setIsGeneratingWorkspace(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [paper?.id, paper?.workspaceAnalysis]);

  useEffect(() => {
    if (!paper || notes === (paper.personalNotes ?? "")) {
      return;
    }

    if (notesDebounceRef.current) {
      window.clearTimeout(notesDebounceRef.current);
    }

    notesDebounceRef.current = window.setTimeout(() => {
      setNotesStatus("saving");
      void updateLiteraturePaperNotes(paper.id, notes)
        .then((updated) => {
          setPaper(updated);
          setNotesStatus("saved");
        })
        .catch(() => {
          setNotesStatus("error");
        });
    }, 800);

    return () => {
      if (notesDebounceRef.current) {
        window.clearTimeout(notesDebounceRef.current);
      }
    };
  }, [notes, paper]);

  const handleStatusChange = useCallback(
    async (status: LiteraturePaperStatus) => {
      if (!paper) {
        return;
      }

      setIsUpdating(true);
      setError(null);

      try {
        const updated = await updateLiteraturePaperStatus(paper.id, status);
        setPaper(updated);
      } catch (err) {
        setError(
          err instanceof LiteratureError
            ? err.message
            : "Failed to update reading status.",
        );
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

  const handleRefreshWorkspace = async () => {
    if (!paper) {
      return;
    }

    setIsGeneratingWorkspace(true);
    setError(null);

    try {
      const result = await generateLiteraturePaperWorkspace(paper.id, true);
      setPaper(result.paper);
      setWorkspace(result.workspaceAnalysis);
    } catch (err) {
      setError(
        err instanceof LiteratureError
          ? err.message
          : "Failed to refresh workspace analysis.",
      );
    } finally {
      setIsGeneratingWorkspace(false);
    }
  };

  const downloadText = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCitation = async () => {
    if (!paper) {
      return;
    }

    await navigator.clipboard.writeText(generateApaCitation(paper));
    setExportMessage("Citation copied to clipboard.");
  };

  const externalId = paper ? getPaperExternalId(paper) : null;
  const journalVenue = paper ? getPaperJournalVenue(paper) : null;
  const doi = paper ? getPaperDoi(paper) : null;
  const subjectTags = paper ? getPaperTags(paper) : [];
  const assignedFolderIds = paper?.folderIds ?? [];
  const googleScholarUrl = paper ? getGoogleScholarUrl(paper) : null;
  const semanticScholarUrl = paper ? getSemanticScholarUrl(paper) : null;

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Research Workspace</h1>
            <p className="text-sm text-gray-500">
              Comprehensive paper analysis, reading guide, and personal notes.
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
              href="/literature"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Tracker
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {exportMessage && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {exportMessage}
          </p>
        )}

        {isLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
            Loading research workspace...
          </div>
        ) : !paper ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">Paper not found</p>
          </div>
        ) : (
          <>
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

            <WorkspaceSection title="Basic Information">
              <h3 className="text-2xl font-semibold leading-tight text-gray-900">
                {paper.title}
              </h3>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoField
                  label="Authors"
                  value={
                    paper.authors.length > 0
                      ? paper.authors.join(", ")
                      : "Unknown authors"
                  }
                />
                <InfoField
                  label="Journal / Venue"
                  value={journalVenue ?? "Not available"}
                />
                <InfoField
                  label="Published date"
                  value={formatLiteratureDate(paper.publishedAt)}
                />
                <InfoField label="DOI" value={doi ?? "Not available"} />
                <InfoField label="Source" value={getPaperSource(paper)} />
                {externalId && (
                  <InfoField label={externalId.label} value={externalId.value} />
                )}
              </dl>
              {subjectTags.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Categories
                  </p>
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
                </div>
              )}
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Abstract
                </p>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">{paper.abstract}</p>
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="External Links">
              <div className="flex flex-wrap gap-2">
                <a
                  href={paper.absUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  Abstract
                </a>
                {hasPaperPdfLink(paper) && (
                  <a
                    href={paper.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    PDF
                  </a>
                )}
                {doi && (
                  <a
                    href={getPaperDoiUrl(doi)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    DOI
                  </a>
                )}
                {googleScholarUrl && (
                  <a
                    href={googleScholarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Google Scholar
                  </a>
                )}
                {semanticScholarUrl && (
                  <a
                    href={semanticScholarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    Semantic Scholar
                  </a>
                )}
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="AI Analysis">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  Structured analysis generated for this paper.
                </p>
                <button
                  type="button"
                  disabled={isGeneratingWorkspace}
                  onClick={() => {
                    void handleRefreshWorkspace();
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingWorkspace ? "Refreshing..." : "Refresh Analysis"}
                </button>
              </div>
              {workspace ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <AnalysisField label="One-sentence summary" value={workspace.oneSentenceSummary} />
                  <AnalysisField label="Research problem" value={workspace.researchProblem} />
                  <AnalysisField label="Core method" value={workspace.coreMethod} />
                  <AnalysisField label="Main contributions" value={workspace.mainContributions} />
                  <AnalysisField
                    label="Experimental results"
                    value={workspace.experimentalResults}
                  />
                  <AnalysisField label="Limitations" value={workspace.limitations} />
                  <AnalysisField label="Why it matters" value={workspace.whyItMatters} />
                </div>
              ) : (
                <p className="text-sm text-gray-500">Generating analysis...</p>
              )}
            </WorkspaceSection>

            {workspace && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <WorkspaceSection title="Reading Guide">
                    <dl className="space-y-4">
                      <InfoField
                        label="Estimated reading time"
                        value={`${workspace.readingGuide.estimatedReadingMinutes} minutes`}
                      />
                      <InfoField
                        label="Difficulty"
                        value={workspace.readingGuide.difficulty}
                      />
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Suggested reading order
                        </dt>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
                          {workspace.readingGuide.suggestedReadingOrder.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </dl>
                  </WorkspaceSection>

                  <WorkspaceSection title="Research Value">
                    <div className="space-y-4">
                      <ScoreRow label="Novelty" score={workspace.researchValue.novelty} />
                      <ScoreRow
                        label="Technical Depth"
                        score={workspace.researchValue.technicalDepth}
                      />
                      <ScoreRow
                        label="Industrial Potential"
                        score={workspace.researchValue.industrialPotential}
                      />
                      <ScoreRow
                        label="Reading Priority"
                        score={workspace.researchValue.readingPriority}
                      />
                    </div>
                  </WorkspaceSection>
                </div>
              </>
            )}

            <WorkspaceSection title="Personal Workspace">
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-gray-900">Folders</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFolderSelectorMode("save")}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                      >
                        Save to Folder
                      </button>
                      <button
                        type="button"
                        onClick={() => setFolderSelectorMode("move")}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                      >
                        Move to Folder
                      </button>
                    </div>
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
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor="paper-notes" className="text-sm font-medium text-gray-900">
                      Personal Notes
                    </label>
                    <span className="text-xs text-gray-500">
                      {notesStatus === "saving" && "Saving..."}
                      {notesStatus === "saved" && "Saved"}
                      {notesStatus === "error" && "Save failed"}
                    </span>
                  </div>
                  <textarea
                    id="paper-notes"
                    rows={6}
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setNotesStatus("idle");
                    }}
                    placeholder="Add your reading notes, hypotheses, or follow-up ideas..."
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900">Reading Status</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        ["saved", "Saved"],
                        ["read", "Read"],
                        ["skipped", "Skipped"],
                        ["new", "New"],
                      ] as const
                    ).map(([status, label]) => (
                      <button
                        key={status}
                        type="button"
                        disabled={isUpdating}
                        onClick={() => {
                          void handleStatusChange(status);
                        }}
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          paper.status === status
                            ? "bg-gray-900 text-white"
                            : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="Export">
              <div className="flex flex-wrap gap-2">
                <ExportButton
                  label="BibTeX"
                  onClick={() => {
                    downloadText(
                      `${paper.arxivId.replace(/[^a-zA-Z0-9.-]/g, "_")}.bib`,
                      generateBibTeX(paper),
                      "application/x-bibtex",
                    );
                    setExportMessage("BibTeX downloaded.");
                  }}
                />
                <ExportButton
                  label="RIS"
                  onClick={() => {
                    downloadText(
                      `${paper.arxivId.replace(/[^a-zA-Z0-9.-]/g, "_")}.ris`,
                      generateRIS(paper),
                      "application/x-research-info-systems",
                    );
                    setExportMessage("RIS downloaded.");
                  }}
                />
                <ExportButton
                  label="Copy Citation"
                  onClick={() => {
                    void handleCopyCitation();
                  }}
                />
                <ExportButton
                  label="Markdown"
                  onClick={() => {
                    downloadText(
                      `${paper.arxivId.replace(/[^a-zA-Z0-9.-]/g, "_")}.md`,
                      generatePaperMarkdown(paper, workspace),
                      "text/markdown",
                    );
                    setExportMessage("Markdown downloaded.");
                  }}
                />
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="Coming Soon">
              <div className="flex flex-wrap gap-2">
                <PlaceholderButton label="Citation Network (Coming Soon)" />
                <PlaceholderButton label="Related Papers (Coming Soon)" />
              </div>
            </WorkspaceSection>
          </>
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
