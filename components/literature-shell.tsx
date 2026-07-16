"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LiteraturePaperCard } from "@/components/literature-paper-card";
import { ResearchPageHeader } from "@/components/research-page-header";
import { ScholarExtensionEntry } from "@/components/scholar-extension-entry";
import {
  LiteraturePaperDebugPanel,
  LiteratureSearchDebugSummary,
} from "@/components/literature-debug-panel";
import {
  LITERATURE_DATE_RANGE_DAYS,
  LITERATURE_DATE_RANGE_OPTIONS,
} from "@/lib/literature/constants";
import {
  fetchLiteratureFolders,
  fetchLiteratureState,
  LiteratureError,
  savePaperSnapshotToFolders,
  setPaperFolders,
  updateLiteraturePaperStatus,
  updateLiteraturePapers,
  uploadPaperPdfToFolders,
} from "@/lib/literature/client";
import { normalizeLiteratureSettings } from "@/lib/literature/normalize-settings";
import {
  DEFAULT_LITERATURE_PAPER_SORT,
  LITERATURE_PAPER_SORT_OPTIONS,
  sortLiteraturePapers,
  type LiteraturePaperSortKey,
} from "@/lib/literature/paper-sort";
import type {
  LiteratureFolder,
  LiteraturePaper,
  LiteraturePaperStatus,
  LiteratureSettings,
} from "@/lib/literature/types";
import type { LiteratureSearchDebug } from "@/lib/literature/search-debug";

const DEFAULT_SETTINGS: LiteratureSettings = normalizeLiteratureSettings({
  dateRangeDays: LITERATURE_DATE_RANGE_DAYS,
});

const TRACKER_SESSION_STORAGE_KEY = "researchgpt:literature-tracker-session:v1";

type LiteratureTrackerSession = {
  settings: LiteratureSettings;
  papers: LiteraturePaper[];
  sortKey: LiteraturePaperSortKey;
  resultKeywords: string;
};

function isLiteraturePaperSortKey(
  value: unknown,
): value is LiteraturePaperSortKey {
  return LITERATURE_PAPER_SORT_OPTIONS.some(
    (option) => option.value === value,
  );
}

function readTrackerSession(): LiteratureTrackerSession | null {
  try {
    const raw = window.sessionStorage.getItem(TRACKER_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<LiteratureTrackerSession>;
    if (
      !parsed.settings ||
      typeof parsed.settings !== "object" ||
      !Array.isArray(parsed.papers)
    ) {
      return null;
    }

    return {
      settings: normalizeLiteratureSettings(parsed.settings),
      papers: parsed.papers,
      sortKey: isLiteraturePaperSortKey(parsed.sortKey)
        ? parsed.sortKey
        : DEFAULT_LITERATURE_PAPER_SORT,
      resultKeywords:
        typeof parsed.resultKeywords === "string"
          ? parsed.resultKeywords
          : parsed.settings.keywords,
    };
  } catch {
    return null;
  }
}

function writeTrackerSession(session: LiteratureTrackerSession): void {
  try {
    window.sessionStorage.setItem(
      TRACKER_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
  } catch {
    // The server remains the fallback when browser storage is unavailable.
  }
}

export function LiteratureShell() {
  const [settings, setSettings] = useState<LiteratureSettings>(DEFAULT_SETTINGS);
  const [papers, setPapers] = useState<LiteraturePaper[]>([]);
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<LiteraturePaperSortKey>(
    DEFAULT_LITERATURE_PAPER_SORT,
  );
  const [searchDebug, setSearchDebug] = useState<LiteratureSearchDebug | null>(
    null,
  );
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [resultKeywords, setResultKeywords] = useState("");

  useEffect(() => {
    let cancelled = false;
    const cachedSession = readTrackerSession();

    void (async () => {
      await Promise.resolve();
      if (cancelled) {
        return;
      }

      if (cachedSession) {
        setSettings(cachedSession.settings);
        setPapers(cachedSession.papers);
        setSortKey(cachedSession.sortKey);
        setResultKeywords(cachedSession.resultKeywords);
      }
      setIsSessionReady(true);

      try {
        const [state, loadedFolders] = await Promise.all([
          fetchLiteratureState(),
          fetchLiteratureFolders(),
        ]);
        if (!cancelled) {
          if (!cachedSession) {
            setSettings(state.settings);
            setPapers(state.papers);
            setResultKeywords(state.settings.keywords);
          }
          setFolders(loadedFolders);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof LiteratureError
              ? err.message
              : "加载文献追踪失败。";
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

  useEffect(() => {
    if (!isSessionReady) {
      return;
    }

    writeTrackerSession({ settings, papers, sortKey, resultKeywords });
  }, [isSessionReady, papers, resultKeywords, settings, sortKey]);

  const handleUpdatePapers = useCallback(async () => {
    setIsUpdating(true);
    setError(null);
    setWarning(null);
    setStatusMessage(null);
    setSearchDebug(null);

    try {
      const result = await updateLiteraturePapers(settings);
      setSettings(result.settings);
      setPapers(result.papers);
      setResultKeywords(result.settings.keywords);
      setSearchDebug(result.debug ?? null);
      setStatusMessage(`已更新 ${result.papers.length} 篇文献。`);

      if (result.warnings?.length || result.failedProviders?.length) {
        setWarning(
          result.warnings?.[0] ??
            "部分数据源暂时不可用，已使用其他来源完成搜索。",
        );
      }
    } catch (err) {
      const detail =
        err instanceof LiteratureError ? err.message : "更新文献失败。";
      setError(`更新失败，正在显示上次结果。${detail}`);
    } finally {
      setIsUpdating(false);
    }
  }, [settings]);

  const handleSaveToFolders = useCallback(
    async (paperId: string, folderIds: string[]) => {
      const sourcePaper = papers.find((paper) => paper.id === paperId);
      let updated;
      let savedFolderIds = folderIds;

      try {
        updated = await updateLiteraturePaperStatus(paperId, "saved");
        savedFolderIds = await setPaperFolders(updated.id, folderIds);
      } catch (error) {
        if (
          !(error instanceof LiteratureError) ||
          error.statusCode !== 404 ||
          !sourcePaper
        ) {
          throw error;
        }

        updated = await savePaperSnapshotToFolders(sourcePaper, folderIds);
        savedFolderIds = updated.folderIds ?? folderIds;
      }

      setPapers((current) =>
        current.map((paper) =>
          paper.id === paperId
            ? { ...updated, folderIds: savedFolderIds }
            : paper,
        ),
      );
    },
    [papers],
  );

  const handleUploadPdfToFolders = useCallback(
    async (paperId: string, folderIds: string[], file: File) => {
      const sourcePaper = papers.find((paper) => paper.id === paperId);

      if (!sourcePaper) {
        throw new LiteratureError("Paper not found.", 404);
      }

      const updated = await uploadPaperPdfToFolders(sourcePaper, folderIds, file);
      const savedFolderIds = updated.folderIds ?? folderIds;

      setPapers((current) =>
        current.map((paper) =>
          paper.id === paperId || paper.arxivId === updated.arxivId
            ? { ...updated, folderIds: savedFolderIds }
            : paper,
        ),
      );
    },
    [papers],
  );

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

  const sortedVisiblePapers = useMemo(
    () => sortLiteraturePapers(visiblePapers, sortKey),
    [visiblePapers, sortKey],
  );

  const paperDebugByArxivId = useMemo(() => {
    if (!searchDebug) {
      return new Map<string, LiteratureSearchDebug["papers"][number]>();
    }

    return new Map(
      searchDebug.papers.map((paperDebug) => [paperDebug.arxivId, paperDebug]),
    );
  }, [searchDebug]);

  const canUpdate = settings.keywords.trim().length > 0;
  const googleScholarUrl = useMemo(() => {
    const query = [settings.researchDirection, settings.keywords]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" ");
    const params = new URLSearchParams({ q: query || settings.keywords });

    return `https://scholar.google.com/scholar?${params.toString()}`;
  }, [settings.keywords, settings.researchDirection]);

  return (
    <div className="min-h-dvh bg-white">
      <ResearchPageHeader
        title="搜索与追踪"
        description="检索、筛选并追踪与你研究方向相关的文献。"
        actions={
          <a
            href={googleScholarUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800"
          >
            在 Google Scholar 搜索
          </a>
        }
      />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <label
                htmlFor="research-direction"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                研究方向
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
                placeholder="例如：基于扩散模型的蛋白质结构预测"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="keywords"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                关键词
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
                placeholder="扩散模型, 蛋白质折叠, 结构预测"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="exclude-keywords"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                排除词
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
                placeholder="综述, 评论"
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="date-range"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                时间范围
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
              {isUpdating ? "正在更新文献…" : "更新文献"}
            </button>
            <a
              href={googleScholarUrl}
              target="_blank"
              rel="noreferrer"
              className="block rounded-xl bg-blue-900 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-800"
            >
              在 Google Scholar 搜索
            </a>
            <ScholarExtensionEntry />
          </section>

          <section className="space-y-4">
            {error && (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            )}

            {warning && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {warning}
              </p>
            )}

            {statusMessage && (
              <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                {statusMessage}
              </p>
            )}

            {isLoading ? (
              <div className="rounded-2xl border border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500">
                正在加载文献追踪…
              </div>
            ) : visiblePapers.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
                <p className="text-sm font-medium text-gray-900">暂无论文</p>
                <p className="mt-2 text-sm text-gray-500">
                  输入关键词后点击「更新文献」，系统将自动检索并分析相关论文。
                </p>
              </div>
            ) : (
              <>
                {searchDebug && (
                  <LiteratureSearchDebugSummary
                    summary={searchDebug.summary}
                    failedProviders={searchDebug.failedProviders}
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-sm text-gray-600">
                    共 {sortedVisiblePapers.length} 篇论文
                  </p>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="literature-sort"
                      className="text-sm font-medium text-gray-700"
                    >
                      排序
                    </label>
                    <select
                      id="literature-sort"
                      value={sortKey}
                      onChange={(event) =>
                        setSortKey(event.target.value as LiteraturePaperSortKey)
                      }
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                    >
                      {LITERATURE_PAPER_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {sortedVisiblePapers.map((paper) => {
                  const paperDebug = paperDebugByArxivId.get(paper.arxivId);

                  return (
                    <div key={paper.id} className="space-y-2">
                      <LiteraturePaperCard
                        paper={paper}
                        variant="tracker"
                        folders={folders}
                        onStatusChange={handleStatusChange}
                        onSaveToFolders={handleSaveToFolders}
                        onUploadPdfToFolders={handleUploadPdfToFolders}
                        onFoldersListUpdated={setFolders}
                        showProviderInternals={searchDebug !== null}
                        highlightKeywords={resultKeywords}
                      />
                      {paperDebug && (
                        <LiteraturePaperDebugPanel paperDebug={paperDebug} />
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
