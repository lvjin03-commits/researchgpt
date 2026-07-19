"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  LogOut,
  MessageSquare,
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
  onNewChat: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onSelectFolder: (folder: LiteratureFolder) => void;
  onOpenFolder: (folder: LiteratureFolder) => void;
  onContinueProject: (project: ResearchProject) => void;
  onLogout: () => void;
  isLoggingOut?: boolean;
  syncError?: string | null;
};

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wide text-gray-400">
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
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onSelectFolder,
  onOpenFolder,
  onContinueProject,
  onLogout,
  isLoggingOut = false,
  syncError = null,
}: SidebarProps) {
  const [folderSearch, setFolderSearch] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
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
            className={`group flex cursor-pointer items-center gap-1 py-1.5 pr-2 text-sm ${
              selected
                ? "bg-blue-50 font-semibold text-blue-800"
                : "text-gray-700 hover:bg-gray-100"
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
              <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-amber-500" />
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
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-gray-200 bg-gray-50 transition-transform md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="科研项目与资料"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <span className="text-sm font-bold text-gray-950">ResearchAI</span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-200 md:hidden"
            aria-label="关闭侧栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="flex w-full items-center gap-2 border border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 shadow-sm hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            新项目
          </button>
        </div>

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
                        ? "bg-gray-900 text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <span className="block truncate text-sm font-bold">
                      {project.name}
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-xs ${
                        project.id === activeProjectId
                          ? "text-gray-300"
                          : "text-gray-500"
                      }`}
                    >
                      {project.lastTask || "等待继续工作"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <SectionTitle>文献资料</SectionTitle>
          <div className="relative mb-2 px-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
            <input
              value={folderSearch}
              onChange={(event) => setFolderSearch(event.target.value)}
              placeholder="搜索文件夹"
              className="h-9 w-full border border-gray-200 bg-white pl-8 pr-2 text-xs outline-none focus:border-gray-400"
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

        <div className="border-t border-gray-200 p-3">
          <a
            href="/literature/library"
            className="mb-1 flex items-center gap-2 px-2 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
          >
            <BookOpen className="h-4 w-4" />
            管理完整文献库
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
