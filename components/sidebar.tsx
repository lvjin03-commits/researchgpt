"use client";

import {
  BookOpen,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Folder,
  FolderOpen,
  Languages,
  LogOut,
  MessageSquare,
  Microscope,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatConversation } from "@/lib/chat/history";
import {
  FOLDER_DRAG_TYPE,
  PAPER_DRAG_TYPE,
  type ResearchProject,
} from "@/lib/chat/workspace";
import type { LiteratureFolder } from "@/lib/literature/types";

type SidebarProps = {
  isOpen: boolean;
  conversations: ChatConversation[];
  activeConversationId: string | null;
  folders: LiteratureFolder[];
  folderCounts: Record<string, number>;
  selectedFolderIds: string[];
  projects: ResearchProject[];
  activeProjectId: string | null;
  onClose: () => void;
  onNewProject: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onSelectFolder: (folder: LiteratureFolder) => void;
  onOpenFolder: (folder: LiteratureFolder) => void;
  onCreateFolder: (name: string) => Promise<LiteratureFolder>;
  onPaperDrop: (paperId: string, folderId: string) => void;
  onContinueProject: (project: ResearchProject) => void;
  onLogout: () => void;
  isLoggingOut?: boolean;
  syncError?: string | null;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1.5 pt-5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7c8b91]">
      {children}
    </p>
  );
}

export function Sidebar({
  isOpen,
  conversations,
  activeConversationId,
  folders,
  folderCounts,
  selectedFolderIds,
  projects,
  activeProjectId,
  onClose,
  onNewProject,
  onSelectConversation,
  onDeleteConversation,
  onSelectFolder,
  onOpenFolder,
  onCreateFolder,
  onPaperDrop,
  onContinueProject,
  onLogout,
  isLoggingOut = false,
  syncError = null,
}: SidebarProps) {
  const [folderSearch, setFolderSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [paperDropFolderId, setPaperDropFolderId] = useState<string | null>(
    null,
  );
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createFolderError, setCreateFolderError] = useState<string | null>(
    null,
  );
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  const matchingFolders = useMemo(() => {
    const query = folderSearch.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) => folder.name.toLowerCase().includes(query));
  }, [folderSearch, folders]);

  const childMap = useMemo(() => {
    const map = new Map<string | null, LiteratureFolder[]>();
    const visibleIds = new Set(matchingFolders.map((folder) => folder.id));
    for (const folder of folders) {
      if (folderSearch && !visibleIds.has(folder.id)) continue;
      const parentId = folderSearch ? null : folder.parentId;
      map.set(parentId, [...(map.get(parentId) ?? []), folder]);
    }
    return map;
  }, [folderSearch, folders, matchingFolders]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const selectAfterClickDelay = (folder: LiteratureFolder) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      onSelectFolder(folder);
      clickTimerRef.current = null;
    }, 230);
  };

  const openOnDoubleClick = (folder: LiteratureFolder) => {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    onOpenFolder(folder);
  };

  const submitNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name || isCreatingFolder) return;

    setIsCreatingFolder(true);
    setCreateFolderError(null);
    try {
      await onCreateFolder(name);
      setNewFolderName("");
      setShowCreateFolder(false);
    } catch (error) {
      setCreateFolderError(
        error instanceof Error ? error.message : "创建文件夹失败，请稍后重试。",
      );
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const renderFolders = (
    parentId: string | null,
    depth = 0,
  ): ReactNode => {
    return (childMap.get(parentId) ?? []).map((folder) => {
      const children = childMap.get(folder.id) ?? [];
      const expanded = expandedFolderIds.has(folder.id);
      const selected = selectedFolderIds.includes(folder.id);
      return (
        <div key={folder.id}>
          <div
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                FOLDER_DRAG_TYPE,
                JSON.stringify({ id: folder.id, name: folder.name }),
              );
            }}
            onClick={() => selectAfterClickDelay(folder)}
            onDoubleClick={() => openOnDoubleClick(folder)}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(PAPER_DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setPaperDropFolderId(folder.id);
            }}
            onDragLeave={() => {
              setPaperDropFolderId((current) =>
                current === folder.id ? null : current,
              );
            }}
            onDrop={(event) => {
              const payload = event.dataTransfer.getData(PAPER_DRAG_TYPE);
              if (!payload) return;
              event.preventDefault();
              event.stopPropagation();
              setPaperDropFolderId(null);
              try {
                const parsed = JSON.parse(payload) as { id?: unknown };
                if (typeof parsed.id === "string") {
                  onPaperDrop(parsed.id, folder.id);
                }
              } catch {
                // Ignore malformed drag data.
              }
            }}
            className={`group flex cursor-pointer items-center gap-1 py-1.5 pr-2 text-sm ${
              paperDropFolderId === folder.id
                ? "bg-[#dce9ee] font-bold text-[#174866] ring-1 ring-inset ring-[#6e9db7]"
                : selected
                  ? "bg-white font-semibold text-[#174866]"
                  : "text-[#52636b] hover:bg-white"
            }`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            title="单击加入聊天，双击打开文件夹，也可拖入聊天框"
          >
            <button
              type="button"
              aria-label={expanded ? "收起子文件夹" : "展开子文件夹"}
              onClick={(event) => {
                event.stopPropagation();
                if (children.length > 0) toggleFolder(folder.id);
              }}
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-400"
            >
              {children.length > 0 ? (
                expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )
              ) : null}
            </button>
            {expanded ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-[#a56518]" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-[#a56518]" />
            )}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="shrink-0 text-[11px] text-gray-400">
              {folderCounts[folder.id] ?? 0}
            </span>
          </div>
          {expanded && renderFolders(folder.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[292px] flex-col border-r border-[#dbe4e7] bg-[#eef3f4] transition-transform md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="科研项目与资料"
      >
        <div className="flex h-16 items-center justify-between px-4">
          <a href="/chat" className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#174866] text-white shadow-sm">
              <Microscope className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-bold text-[#172126]">ResearchGPT</span>
              <span className="block text-[10px] font-medium text-[#718087]">科研工作台</span>
            </span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-200 md:hidden"
            aria-label="关闭侧栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => {
              onNewProject();
              onClose();
            }}
            className="flex h-10 w-full items-center gap-2 rounded-md bg-[#174866] px-3 text-sm font-bold text-white shadow-sm hover:bg-[#123a52]"
          >
            <Plus className="h-4 w-4" />
            新项目
          </button>
        </div>

        <nav className="grid grid-cols-2 gap-1 px-3 pb-2" aria-label="快捷功能">
          <a href="/literature" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[#52636b] hover:bg-white hover:text-[#174866]">
            <Search className="h-3.5 w-3.5" /> 文献搜索
          </a>
          <a href="/literature/library" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[#52636b] hover:bg-white hover:text-[#174866]">
            <BookOpen className="h-3.5 w-3.5" /> 文献库
          </a>
          <a href="/presentation" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[#52636b] hover:bg-white hover:text-[#174866]">
            <ChartNoAxesCombined className="h-3.5 w-3.5" /> 成果制作
          </a>
          <a href="/translate" className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[#52636b] hover:bg-white hover:text-[#174866]">
            <Languages className="h-3.5 w-3.5" /> 学术翻译
          </a>
        </nav>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {syncError && (
            <p className="mx-1 mt-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {syncError}
            </p>
          )}

          <SectionTitle>科研项目</SectionTitle>
          {projects.length === 0 ? (
            <p className="px-2 py-2 text-xs leading-5 text-gray-500">
              直接开始聊天。任务需要持续保存时，AI 会建议创建项目。
            </p>
          ) : (
            <ul className="space-y-1">
              {projects.slice(0, 8).map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onContinueProject(project);
                      onClose();
                    }}
                    className={`w-full px-2 py-2 text-left ${
                      project.id === activeProjectId
                        ? "rounded-md bg-[#dce9ee] text-[#174866]"
                        : "rounded-md text-[#52636b] hover:bg-white"
                    }`}
                  >
                    <span className="block truncate text-sm font-bold">
                      {project.name}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-xs ${
                        project.id === activeProjectId
                          ? "font-semibold text-[#52636b]"
                          : "font-medium text-[#607078]"
                      }`}
                    >
                      {project.lastTask || "等待继续工作"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between px-2 pb-1.5 pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7c8b91]">
              文献资料
            </p>
            <button
              type="button"
              onClick={() => {
                setShowCreateFolder((current) => !current);
                setCreateFolderError(null);
              }}
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold text-[#174866] hover:bg-white"
              aria-expanded={showCreateFolder}
              aria-label="新建文献文件夹"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
          </div>
          {showCreateFolder && (
            <div className="mx-1 mb-2 rounded-md border border-[#c9d7dc] bg-white p-2 shadow-sm">
              <label htmlFor="sidebar-new-folder" className="sr-only">
                文件夹名称
              </label>
              <input
                id="sidebar-new-folder"
                autoFocus
                value={newFolderName}
                disabled={isCreatingFolder}
                onChange={(event) => setNewFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitNewFolder();
                  }
                  if (event.key === "Escape") {
                    setShowCreateFolder(false);
                    setNewFolderName("");
                    setCreateFolderError(null);
                  }
                }}
                placeholder="输入文件夹名称"
                className="research-focus h-9 w-full rounded-md border border-[#d4dfe2] px-2.5 text-xs"
              />
              <div className="mt-2 flex justify-end gap-1.5">
                <button
                  type="button"
                  disabled={isCreatingFolder}
                  onClick={() => {
                    setShowCreateFolder(false);
                    setNewFolderName("");
                    setCreateFolderError(null);
                  }}
                  className="rounded-md px-2.5 py-1.5 text-[11px] font-bold text-[#607078] hover:bg-[#f0f4f5]"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isCreatingFolder || !newFolderName.trim()}
                  onClick={() => void submitNewFolder()}
                  className="rounded-md bg-[#174866] px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-[#123a52] disabled:cursor-not-allowed disabled:bg-[#c8d4d8]"
                >
                  {isCreatingFolder ? "创建中..." : "创建"}
                </button>
              </div>
              {createFolderError && (
                <p className="mt-2 text-[11px] leading-4 text-red-600">
                  {createFolderError}
                </p>
              )}
            </div>
          )}
          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
            <input
              value={folderSearch}
              onChange={(event) => setFolderSearch(event.target.value)}
              placeholder="搜索文件夹"
              className="research-focus h-9 w-full rounded-md border border-[#d4dfe2] bg-white pl-8 pr-2 text-xs"
            />
          </div>
          {matchingFolders.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-500">
              {folderSearch ? "没有匹配的文件夹" : "还没有文献文件夹"}
            </p>
          ) : (
            <div>{renderFolders(null)}</div>
          )}

          <SectionTitle>最近对话</SectionTitle>
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-500">暂无对话</p>
          ) : (
            <ul className="space-y-1">
              {conversations.slice(0, 12).map((conversation) => (
                <li
                  key={conversation.id}
                  className={`group flex items-center ${
                    conversation.id === activeConversationId
                      ? "bg-gray-200"
                      : "hover:bg-gray-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectConversation(conversation.id);
                      onClose();
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-sm text-gray-700"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{conversation.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteConversation(conversation.id)}
                    aria-label={`删除“${conversation.title}”`}
                    className="mr-1 p-1.5 text-gray-400 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-[#dbe4e7] p-3">
          <a
            href="/literature/library"
            className="mb-1 flex items-center gap-2 px-2 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            <BookOpen className="h-4 w-4" />
            管理完整文献库
          </a>
          <a
            href="/usage"
            className="mb-1 flex items-center gap-2 px-2 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            <CircleDollarSign className="h-4 w-4" />
            AI 用量与成本
          </a>
          <button
            type="button"
            onClick={onLogout}
            disabled={isLoggingOut}
            className="flex w-full items-center gap-2 px-2 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {isLoggingOut ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </aside>
    </>
  );
}
