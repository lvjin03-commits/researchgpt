"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiteraturePaperFolderSelector } from "@/components/literature-paper-folder-selector";
import { LITERATURE_PRIORITY_LABELS } from "@/lib/literature/constants";
import {
  fetchLiteratureFolders,
  fetchLiteraturePaper,
  fetchLiteraturePaperCitationNetwork,
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
  PaperCitationNetwork,
  PaperCitationNetworkItem,
  PaperWorkspaceAnalysis,
} from "@/lib/literature/types";
import { deriveWorkspaceAnalysisFromPaper } from "@/lib/literature/paper-workspace-display";
import {
  getPaperStatusLabel,
  LITERATURE_DIFFICULTY_LABELS,
} from "@/lib/literature/ui-strings";

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

function CitationNetworkPaperList({
  items,
  emptyLabel,
}: {
  items: PaperCitationNetworkItem[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li
          key={item.paperId ?? `${item.title}-${index}`}
          className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3"
        >
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              {item.title}
            </a>
          ) : (
            <p className="text-sm font-medium text-gray-900">{item.title}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
            {item.authors.length > 0 && <span>{item.authors.join(", ")}</span>}
            {item.year !== null && <span>{item.year} 年</span>}
            {item.citationCount !== null && (
              <span>被引 {item.citationCount.toLocaleString("zh-CN")} 次</span>
            )}
            {item.doi && (
              <a
                href={`https://doi.org/${item.doi}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                DOI
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CitationCountCard({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {value === null ? "—" : value.toLocaleString("zh-CN")}
      </p>
    </div>
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
  const [citationNetwork, setCitationNetwork] = useState<PaperCitationNetwork | null>(
    null,
  );
  const [isCitationNetworkLoading, setIsCitationNetworkLoading] = useState(true);
  const [citationNetworkError, setCitationNetworkError] = useState<string | null>(
    null,
  );
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
            err instanceof LiteratureError ? err.message : "加载论文失败。",
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
    let cancelled = false;

    void (async () => {
      setIsCitationNetworkLoading(true);
      setCitationNetworkError(null);

      try {
        const network = await fetchLiteraturePaperCitationNetwork(paperId);
        if (!cancelled) {
          setCitationNetwork(network);
        }
      } catch (err) {
        if (!cancelled) {
          setCitationNetworkError(
            err instanceof LiteratureError
              ? err.message
              : "加载引用网络失败。",
          );
        }
      } finally {
        if (!cancelled) {
          setIsCitationNetworkLoading(false);
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
            : "更新阅读状态失败。",
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
          : "刷新 AI 分析失败。",
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
    setExportMessage("引用已复制到剪贴板。");
  };

  const externalId = paper ? getPaperExternalId(paper) : null;
  const journalVenue = paper ? getPaperJournalVenue(paper) : null;
  const doi = paper ? getPaperDoi(paper) : null;
  const subjectTags = paper ? getPaperTags(paper) : [];
  const assignedFolderIds = paper?.folderIds ?? [];
  const googleScholarUrl = paper ? getGoogleScholarUrl(paper) : null;
  const semanticScholarUrl = paper ? getSemanticScholarUrl(paper) : null;
  const hasCitationNetworkData =
    citationNetwork !== null &&
    (citationNetwork.citationCount !== null ||
      citationNetwork.referenceCount !== null ||
      citationNetwork.influentialCitationCount !== null ||
      citationNetwork.references.length > 0 ||
      citationNetwork.citations.length > 0 ||
      citationNetwork.relatedPapers.length > 0);

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">论文详情</h1>
            <p className="text-sm text-gray-500">
              论文分析、阅读指南与个人笔记工作区。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/literature/library"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              文献库
            </Link>
            <Link
              href="/literature"
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              文献追踪
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
            正在加载论文详情…
          </div>
        ) : !paper ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">未找到论文</p>
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
                  相关度 {paper.relevanceScore}
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                {getPaperStatusLabel(paper.status)}
              </span>
            </div>

            <WorkspaceSection title="基本信息">
              <h3 className="text-2xl font-semibold leading-tight text-gray-900">
                {paper.title}
              </h3>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoField
                  label="作者"
                  value={
                    paper.authors.length > 0
                      ? paper.authors.join(", ")
                      : "未知作者"
                  }
                />
                <InfoField
                  label="期刊"
                  value={journalVenue ?? "暂无"}
                />
                <InfoField
                  label="发表时间"
                  value={formatLiteratureDate(paper.publishedAt)}
                />
                <InfoField label="DOI" value={doi ?? "暂无"} />
                <InfoField label="来源" value={getPaperSource(paper)} />
                {externalId && (
                  <InfoField label={externalId.label} value={externalId.value} />
                )}
              </dl>
              {subjectTags.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    分类
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
                  摘要
                </p>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">{paper.abstract}</p>
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="外部链接">
              <div className="flex flex-wrap gap-2">
                <a
                  href={paper.absUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  原文链接
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
                    Google 学术
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

            <WorkspaceSection title="AI 分析">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  为本论文生成的结构化 AI 分析。
                </p>
                <button
                  type="button"
                  disabled={isGeneratingWorkspace}
                  onClick={() => {
                    void handleRefreshWorkspace();
                  }}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGeneratingWorkspace ? "正在刷新…" : "刷新分析"}
                </button>
              </div>
              {workspace ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <AnalysisField label="一句话摘要" value={workspace.oneSentenceSummary} />
                  <AnalysisField label="研究问题" value={workspace.researchProblem} />
                  <AnalysisField label="核心方法" value={workspace.coreMethod} />
                  <AnalysisField label="主要贡献" value={workspace.mainContributions} />
                  <AnalysisField
                    label="实验结果"
                    value={workspace.experimentalResults}
                  />
                  <AnalysisField label="局限性" value={workspace.limitations} />
                  <AnalysisField label="研究意义" value={workspace.whyItMatters} />
                </div>
              ) : (
                <p className="text-sm text-gray-500">正在生成分析…</p>
              )}
            </WorkspaceSection>

            {workspace && (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <WorkspaceSection title="阅读指南">
                    <dl className="space-y-4">
                      <InfoField
                        label="预计阅读时间"
                        value={`${workspace.readingGuide.estimatedReadingMinutes} 分钟`}
                      />
                      <InfoField
                        label="难度"
                        value={
                          LITERATURE_DIFFICULTY_LABELS[workspace.readingGuide.difficulty]
                        }
                      />
                      <div>
                        <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          建议阅读顺序
                        </dt>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
                          {workspace.readingGuide.suggestedReadingOrder.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    </dl>
                  </WorkspaceSection>

                  <WorkspaceSection title="研究价值">
                    <div className="space-y-4">
                      <ScoreRow label="新颖性" score={workspace.researchValue.novelty} />
                      <ScoreRow
                        label="技术深度"
                        score={workspace.researchValue.technicalDepth}
                      />
                      <ScoreRow
                        label="产业潜力"
                        score={workspace.researchValue.industrialPotential}
                      />
                      <ScoreRow
                        label="阅读优先级"
                        score={workspace.researchValue.readingPriority}
                      />
                    </div>
                  </WorkspaceSection>
                </div>
              </>
            )}

            <WorkspaceSection title="个人工作区">
              <div className="space-y-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-gray-900">文献夹</h3>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setFolderSelectorMode("save")}
                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
                      >
                        保存到文献夹
                      </button>
                      <button
                        type="button"
                        onClick={() => setFolderSelectorMode("move")}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
                      >
                        移动到文献夹
                      </button>
                    </div>
                  </div>
                  {assignedFolderIds.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-500">
                      该论文尚未加入任何文献夹。
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
                      我的笔记
                    </label>
                    <span className="text-xs text-gray-500">
                      {notesStatus === "saving" && "正在保存…"}
                      {notesStatus === "saved" && "已保存"}
                      {notesStatus === "error" && "保存失败"}
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
                    placeholder="记录阅读笔记、假设或后续想法…"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-900 focus:border-gray-300 focus:outline-none"
                  />
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-900">阅读状态</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        ["saved", getPaperStatusLabel("saved")],
                        ["read", getPaperStatusLabel("read")],
                        ["skipped", getPaperStatusLabel("skipped")],
                        ["new", getPaperStatusLabel("new")],
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

            <WorkspaceSection title="导出">
              <div className="flex flex-wrap gap-2">
                <ExportButton
                  label="BibTeX"
                  onClick={() => {
                    downloadText(
                      `${paper.arxivId.replace(/[^a-zA-Z0-9.-]/g, "_")}.bib`,
                      generateBibTeX(paper),
                      "application/x-bibtex",
                    );
                    setExportMessage("BibTeX 已下载。");
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
                    setExportMessage("RIS 已下载。");
                  }}
                />
                <ExportButton
                  label="复制引用"
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
                    setExportMessage("Markdown 已下载。");
                  }}
                />
              </div>
            </WorkspaceSection>

            <WorkspaceSection title="引用网络">
              {isCitationNetworkLoading ? (
                <p className="text-sm text-gray-500">正在加载引用数据…</p>
              ) : citationNetwork?.rateLimited ? (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {citationNetwork.message ??
                    "Semantic Scholar 请求过于频繁，请稍后再试。"}
                </p>
              ) : citationNetworkError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {citationNetworkError}
                </p>
              ) : !hasCitationNetworkData ? (
                <p className="text-sm text-gray-500">暂无引用数据</p>
              ) : (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <CitationCountCard
                      label="被引次数"
                      value={citationNetwork?.citationCount ?? null}
                    />
                    <CitationCountCard
                      label="参考文献数"
                      value={citationNetwork?.referenceCount ?? null}
                    />
                    <CitationCountCard
                      label="高影响力引用"
                      value={citationNetwork?.influentialCitationCount ?? null}
                    />
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-900">参考文献</h3>
                    <div className="mt-3">
                      <CitationNetworkPaperList
                        items={citationNetwork?.references ?? []}
                        emptyLabel="暂无引用数据"
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-900">被引用文献</h3>
                    <div className="mt-3">
                      <CitationNetworkPaperList
                        items={citationNetwork?.citations ?? []}
                        emptyLabel="暂无引用数据"
                      />
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium text-gray-900">相关推荐</h3>
                    <div className="mt-3">
                      <CitationNetworkPaperList
                        items={citationNetwork?.relatedPapers ?? []}
                        emptyLabel="暂无引用数据"
                      />
                    </div>
                  </div>
                </div>
              )}
            </WorkspaceSection>
          </>
        )}
      </main>

      {folderSelectorMode && paper && (
        <LiteraturePaperFolderSelector
          title={folderSelectorMode === "save" ? "保存到文献夹" : "移动到文献夹"}
          description={
            folderSelectorMode === "save"
              ? "选择一个或多个文献夹，论文将标记为已收藏。"
              : "添加或移除该论文所属的文献夹。"
          }
          confirmLabel={folderSelectorMode === "save" ? "保存到文献夹" : "保存"}
          folders={folders}
          selectedFolderIds={assignedFolderIds}
          onClose={() => setFolderSelectorMode(null)}
          onConfirm={
            folderSelectorMode === "save" ? handleSaveToFolders : handleMoveToFolders
          }
          onFoldersUpdated={setFolders}
        />
      )}
    </div>
  );
}
