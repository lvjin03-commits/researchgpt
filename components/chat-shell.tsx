"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, PanelRightOpen, Sparkles } from "lucide-react";
import { ChatInput, type ChatSendPayload } from "@/components/chat-input";
import { ChatMessages } from "@/components/chat-messages";
import { MenuIcon } from "@/components/icons";
import { ResearchToolPanel } from "@/components/research-tool-panel";
import { Sidebar } from "@/components/sidebar";
import type { ChatMessage } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  isChatModelTier,
  type ChatModelTier,
} from "@/lib/ai/chat-models";
import {
  ChatClientError,
  isAbortError,
  streamChatResponse,
} from "@/lib/chat/client";
import {
  buildChatApiMessages,
  defaultContentForAttachments,
} from "@/lib/chat/message-normalize";
import type { DisplayAttachment, DisplayChatMessage } from "@/lib/chat/types";
import { useChatHistory } from "@/lib/chat/use-chat-history";
import {
  createResearchProject,
  loadWorkspace,
  saveWorkspace,
  shouldSuggestProject,
  shouldSuggestTemporaryQuestion,
  type ResearchProject,
  type WorkspaceContextMode,
} from "@/lib/chat/workspace";
import { fetchLiteratureLibrary } from "@/lib/literature/client";
import type {
  LiteratureFolder,
  LiteraturePaper,
} from "@/lib/literature/types";
import { createClient } from "@/lib/supabase/client";
import { getAttachmentKind } from "@/lib/uploads/constants";

const CHAT_LIBRARY_FILTERS = {
  status: "all" as const,
  q: "",
  source: "",
  discipline: "",
  priority: "",
  folderId: "",
};

function toDisplayAttachments(files: File[]): DisplayAttachment[] {
  return files.flatMap((file) => {
    const kind = getAttachmentKind(file.name);
    return kind ? [{ name: file.name, kind }] : [];
  });
}

function toApiUserMessage(payload: ChatSendPayload): ChatMessage {
  const trimmed = payload.message.trim();
  if (trimmed) return { role: "user", content: trimmed };
  const attachments = toDisplayAttachments(payload.files ?? []);
  return {
    role: "user",
    content: defaultContentForAttachments(attachments),
  };
}

function toDisplayUserMessage(payload: ChatSendPayload): DisplayChatMessage {
  return {
    role: "user",
    content: payload.message.trim(),
    attachments: payload.files
      ? toDisplayAttachments(payload.files)
      : undefined,
  };
}

function projectNameFromTask(
  message: string,
  folders: LiteratureFolder[],
): string {
  if (folders.length === 1) return folders[0].name;
  if (folders.length > 1) return `${folders[0].name} 等文献研究`;
  return message.trim().slice(0, 28) || "新科研项目";
}

export function ChatShell() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolPanelOpen, setToolPanelOpen] = useState(false);
  const [activeToolFolderId, setActiveToolFolderId] = useState<string | null>(
    null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0, total: 0 });
  const [webSearch, setWebSearch] = useState(false);
  const [useLibrary, setUseLibrary] = useState(false);
  const [memory, setMemory] = useState("");
  const [modelTier, setModelTier] = useState<ChatModelTier>(
    DEFAULT_CHAT_MODEL_TIER,
  );
  const [folders, setFolders] = useState<LiteratureFolder[]>([]);
  const [libraryPapers, setLibraryPapers] = useState<LiteraturePaper[]>([]);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [contextMode, setContextMode] =
    useState<WorkspaceContextMode>("auto");
  const [pendingProjectPayload, setPendingProjectPayload] =
    useState<ChatSendPayload | null>(null);
  const [pendingTemporaryPayload, setPendingTemporaryPayload] =
    useState<ChatSendPayload | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);

  const {
    conversations,
    activeConversationId,
    activeMessages,
    isHydrated,
    syncError,
    startNewChat,
    selectConversation,
    deleteConversation,
    persistConversation,
    ensureActiveConversation,
    flushCloudSync,
  } = useChatHistory();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedTier = window.localStorage.getItem(
        "researchgpt-chat-model-tier",
      );
      if (isChatModelTier(savedTier)) setModelTier(savedTier);
      setWebSearch(
        window.localStorage.getItem("researchgpt-chat-web") === "true",
      );
      setUseLibrary(
        window.localStorage.getItem("researchgpt-chat-library") === "true",
      );
      setMemory(window.localStorage.getItem("researchgpt-chat-memory") ?? "");

      const workspace = loadWorkspace();
      setProjects(workspace.projects);
      setActiveProjectId(workspace.activeProjectId);
      const restoredProject = workspace.projects.find(
        (project) => project.id === workspace.activeProjectId,
      );
      if (restoredProject) {
        setSelectedFolderIds(restoredProject.folderIds);
        setContextMode("project");
        setUseLibrary(restoredProject.folderIds.length > 0);
      }
      setWorkspaceHydrated(true);
    }, 0);

    void fetchLiteratureLibrary(CHAT_LIBRARY_FILTERS)
      .then((result) => {
        setFolders(result.folders);
        setLibraryPapers(result.papers);
      })
      .catch(() => {
        setError("文献文件夹加载失败，可刷新页面后重试。");
      });

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    saveWorkspace({ projects, activeProjectId });
  }, [projects, activeProjectId, workspaceHydrated]);

  const selectedFolders = useMemo(
    () => folders.filter((folder) => selectedFolderIds.includes(folder.id)),
    [folders, selectedFolderIds],
  );
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const paper of libraryPapers) {
      for (const folderId of paper.folderIds ?? []) {
        counts[folderId] = (counts[folderId] ?? 0) + 1;
      }
    }
    return counts;
  }, [libraryPapers]);
  const activeProject =
    projects.find((project) => project.id === activeProjectId) ?? null;
  const activeToolFolder =
    folders.find((folder) => folder.id === activeToolFolderId) ?? null;
  const toolPapers = activeToolFolderId
    ? libraryPapers.filter((paper) =>
        (paper.folderIds ?? []).includes(activeToolFolderId),
      )
    : [];

  const abortActiveStream = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const handleModelTierChange = useCallback((tier: ChatModelTier) => {
    setModelTier(tier);
    window.localStorage.setItem("researchgpt-chat-model-tier", tier);
  }, []);
  const handleWebSearchChange = useCallback((enabled: boolean) => {
    setWebSearch(enabled);
    window.localStorage.setItem("researchgpt-chat-web", String(enabled));
  }, []);
  const handleUseLibraryChange = useCallback((enabled: boolean) => {
    setUseLibrary(enabled);
    window.localStorage.setItem("researchgpt-chat-library", String(enabled));
  }, []);
  const handleMemoryChange = useCallback((value: string) => {
    setMemory(value);
    window.localStorage.setItem("researchgpt-chat-memory", value);
  }, []);

  const handleNewChat = useCallback(() => {
    abortActiveStream();
    setError(null);
    setActiveProjectId(null);
    setSelectedFolderIds([]);
    setContextMode("auto");
    setPendingProjectPayload(null);
    setPendingTemporaryPayload(null);
    startNewChat();
  }, [abortActiveStream, startNewChat]);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      abortActiveStream();
      setError(null);
      setIsStreaming(false);
      setActiveProjectId(
        projects.find((project) => project.conversationId === conversationId)
          ?.id ?? null,
      );
      const matchingProject = projects.find(
        (project) => project.conversationId === conversationId,
      );
      setSelectedFolderIds(matchingProject?.folderIds ?? []);
      setContextMode(matchingProject ? "project" : "auto");
      selectConversation(conversationId);
    },
    [abortActiveStream, projects, selectConversation],
  );

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      abortActiveStream();
      deleteConversation(conversationId);
      setProjects((current) =>
        current.map((project) =>
          project.conversationId === conversationId
            ? { ...project, conversationId: null }
            : project,
        ),
      );
    },
    [abortActiveStream, deleteConversation],
  );

  const handleContinueProject = useCallback(
    (project: ResearchProject) => {
      setActiveProjectId(project.id);
      setSelectedFolderIds(project.folderIds);
      setContextMode("project");
      setUseLibrary(project.folderIds.length > 0);
      if (project.conversationId) selectConversation(project.conversationId);
      else startNewChat();
      if (project.folderIds[0]) {
        setActiveToolFolderId(project.folderIds[0]);
        setToolPanelOpen(true);
      }
    },
    [selectConversation, startNewChat],
  );

  const handleSelectFolder = useCallback((folder: LiteratureFolder) => {
    setSelectedFolderIds((current) =>
      current.includes(folder.id) ? current : [...current, folder.id],
    );
    setUseLibrary(true);
  }, []);

  const handleOpenFolder = useCallback((folder: LiteratureFolder) => {
    setActiveToolFolderId(folder.id);
    setToolPanelOpen(true);
  }, []);

  const handleFolderDrop = useCallback((folderId: string) => {
    setSelectedFolderIds((current) =>
      current.includes(folderId) ? current : [...current, folderId],
    );
    setUseLibrary(true);
  }, []);

  const handleLogout = useCallback(async () => {
    abortActiveStream();
    setIsLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth");
      router.refresh();
    } catch {
      setError("退出登录失败，请重试。");
      setIsLoggingOut(false);
    }
  }, [abortActiveStream, router]);

  const submitMessage = useCallback(
    async (
      payload: ChatSendPayload,
      history: DisplayChatMessage[] = activeMessages,
      projectOverride?: ResearchProject | null,
      contextModeOverride?: WorkspaceContextMode,
    ) => {
      abortControllerRef.current?.abort();
      const project =
        projectOverride === undefined ? activeProject : projectOverride;
      const displayUserMessage = toDisplayUserMessage(payload);
      const nextMessages: DisplayChatMessage[] = [
        ...history,
        displayUserMessage,
        { role: "assistant", content: "" },
      ];
      const conversationId = await ensureActiveConversation(nextMessages);
      persistConversation(conversationId, nextMessages);

      if (project) {
        const now = new Date().toISOString();
        setProjects((current) => {
          const without = current.filter((item) => item.id !== project.id);
          return [
            {
              ...project,
              conversationId,
              folderIds: selectedFolderIds,
              lastTask: payload.message,
              updatedAt: now,
            },
            ...without,
          ];
        });
        setActiveProjectId(project.id);
      }

      const apiMessages = buildChatApiMessages(
        history,
        toApiUserMessage(payload),
      );
      setError(null);
      setActivity("正在准备回答");
      setIsStreaming(true);
      if (selectedFolderIds.length > 0) {
        setActiveToolFolderId((current) => current ?? selectedFolderIds[0]);
        setToolPanelOpen(true);
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      let streamingMessages = nextMessages;

      const appendToAssistant = (content: string) => {
        streamingMessages = streamingMessages.map((message, index) =>
          index === streamingMessages.length - 1 &&
          message.role === "assistant"
            ? { ...message, content: message.content + content }
            : message,
        );
        persistConversation(conversationId, streamingMessages);
      };

      try {
        await streamChatResponse(apiMessages, {
          files: payload.files,
          signal: abortController.signal,
          modelTier,
          webSearch,
          useLibrary,
          memory,
          selectedFolderIds,
          contextMode: contextModeOverride ?? contextMode,
          projectName: project?.name,
          onStatus: setActivity,
          onUsage: (nextUsage) =>
            setUsage((current) => ({
              input: current.input + nextUsage.inputTokens,
              output: current.output + nextUsage.outputTokens,
              total: current.total + nextUsage.totalTokens,
            })),
          onSources: (sources) => {
            if (sources.length === 0) return;
            appendToAssistant(
              [
                "",
                "",
                "### 来源",
                ...sources.map(
                  (source, index) =>
                    `${index + 1}. [${source.title.replaceAll("[", "").replaceAll("]", "")}](${source.url})`,
                ),
              ].join("\n"),
            );
          },
          onImages: (images) => {
            if (images.length === 0) return;
            appendToAssistant(
              [
                "",
                "",
                "### 相关图片",
                ...images.map(
                  (image, index) =>
                    `${index + 1}. [![${image.title.replaceAll("[", "").replaceAll("]", "")}](${image.imageUrl})](${image.sourceUrl})`,
                ),
              ].join("\n"),
            );
          },
          onAttachmentsPrepared: (context) => {
            streamingMessages = streamingMessages.map((message, index) => {
              if (index !== history.length || message.role !== "user") {
                return message;
              }
              return {
                ...message,
                attachments: message.attachments?.map(
                  (attachment, attachmentIndex) => ({
                    ...attachment,
                    context: attachmentIndex === 0 ? context : undefined,
                  }),
                ),
              };
            });
            persistConversation(conversationId, streamingMessages);
          },
          onAttachmentResults: (results) => {
            const readyCount = results.filter(
              (result) => result.status === "ready",
            ).length;
            const failedCount = results.length - readyCount;
            setActivity(
              failedCount
                ? `已读取 ${readyCount} 个文件，${failedCount} 个解析失败`
                : `已读取 ${readyCount} 个文件，正在分析内容`,
            );
          },
          onChunk: appendToAssistant,
        });
      } catch (caught) {
        if (isAbortError(caught)) {
          const last = streamingMessages.at(-1);
          if (last?.role === "assistant" && !last.content.trim()) {
            persistConversation(conversationId, streamingMessages.slice(0, -1));
          }
          return;
        }
        setError(
          caught instanceof ChatClientError
            ? caught.message
            : "出现错误，请重试。",
        );
      } finally {
        setIsStreaming(false);
        setActivity(null);
        abortControllerRef.current = null;
        if (contextModeOverride === "temporary") {
          setContextMode(project ? "project" : "auto");
        }
        await flushCloudSync();
      }
    },
    [
      abortControllerRef,
      activeMessages,
      activeProject,
      contextMode,
      ensureActiveConversation,
      flushCloudSync,
      memory,
      modelTier,
      persistConversation,
      selectedFolderIds,
      useLibrary,
      webSearch,
    ],
  );

  const handleSend = useCallback(
    (payload: ChatSendPayload) => {
      if (
        activeProject &&
        shouldSuggestTemporaryQuestion(payload.message, activeProject)
      ) {
        setPendingTemporaryPayload(payload);
        return;
      }
      if (
        !activeProject &&
        shouldSuggestProject(payload.message, selectedFolderIds.length)
      ) {
        setPendingProjectPayload(payload);
        return;
      }
      void submitMessage(payload);
    },
    [activeProject, selectedFolderIds.length, submitMessage],
  );

  const answerOutsideProject = useCallback(() => {
    if (!pendingTemporaryPayload) return;
    const payload = pendingTemporaryPayload;
    setPendingTemporaryPayload(null);
    startNewChat();
    setActiveProjectId(null);
    setSelectedFolderIds([]);
    setContextMode("temporary");
    void submitMessage(payload, [], null, "temporary");
  }, [pendingTemporaryPayload, startNewChat, submitMessage]);

  const answerInsideProject = useCallback(() => {
    if (!pendingTemporaryPayload) return;
    const payload = pendingTemporaryPayload;
    setPendingTemporaryPayload(null);
    setContextMode("project");
    void submitMessage(payload, activeMessages, activeProject, "project");
  }, [
    activeMessages,
    activeProject,
    pendingTemporaryPayload,
    submitMessage,
  ]);

  useEffect(() => {
    if (!pendingTemporaryPayload) return;
    const timer = window.setTimeout(() => {
      answerOutsideProject();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [
    answerOutsideProject,
    pendingTemporaryPayload,
  ]);

  const confirmCreateProject = useCallback(() => {
    if (!pendingProjectPayload) return;
    const project = createResearchProject(
      projectNameFromTask(pendingProjectPayload.message, selectedFolders),
      selectedFolderIds,
      pendingProjectPayload.message,
    );
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setContextMode("project");
    const payload = pendingProjectPayload;
    setPendingProjectPayload(null);
    void submitMessage(payload, activeMessages, project);
  }, [
    activeMessages,
    pendingProjectPayload,
    selectedFolderIds,
    selectedFolders,
    submitMessage,
  ]);

  const sendAsTemporary = useCallback(() => {
    if (!pendingProjectPayload) return;
    const payload = pendingProjectPayload;
    setPendingProjectPayload(null);
    setContextMode("temporary");
    void submitMessage(payload, activeMessages, null, "temporary");
  }, [activeMessages, pendingProjectPayload, submitMessage]);

  const handleEditMessage = useCallback(
    (index: number) => {
      const message = activeMessages[index];
      if (!message || message.role !== "user") return;
      const edited = window.prompt("编辑消息", message.content);
      if (!edited?.trim()) return;
      void submitMessage(
        { message: edited.trim() },
        activeMessages.slice(0, index),
      );
    },
    [activeMessages, submitMessage],
  );

  const handleRetryMessage = useCallback(
    (index: number) => {
      const userMessage = activeMessages[index - 1];
      if (!userMessage || userMessage.role !== "user") return;
      void submitMessage(
        { message: userMessage.content },
        activeMessages.slice(0, index - 1),
      );
    },
    [activeMessages, submitMessage],
  );

  const hasMessages = activeMessages.length > 0;
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const chatTitle = activeConversation?.title ?? "新项目";

  if (!isHydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white text-sm text-gray-500">
        正在加载科研工作台…
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-white">
      <Sidebar
        isOpen={sidebarOpen}
        conversations={conversations}
        activeConversationId={activeConversationId}
        folders={folders}
        folderCounts={folderCounts}
        selectedFolderIds={selectedFolderIds}
        projects={projects}
        activeProjectId={activeProjectId}
        onClose={() => setSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onSelectFolder={handleSelectFolder}
        onOpenFolder={handleOpenFolder}
        onContinueProject={handleContinueProject}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        syncError={syncError}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-100 px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 md:hidden"
            aria-label="打开侧栏"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-gray-950">
              {activeProject?.name || chatTitle}
            </p>
            <p className="truncate text-[11px] text-gray-500">
              {contextMode === "temporary"
                ? "临时问题，不使用项目上下文"
                : selectedFolders.length > 0
                  ? `已选择 ${selectedFolders.length} 个文献文件夹`
                  : "未选择项目资料"}
            </p>
          </div>
          {!toolPanelOpen && (
            <button
              type="button"
              onClick={() => setToolPanelOpen(true)}
              className="ml-auto inline-flex h-9 items-center gap-2 border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
            >
              <PanelRightOpen className="h-4 w-4" />
              工作台
            </button>
          )}
        </header>

        <main className="relative flex flex-1 flex-col overflow-hidden">
          {hasMessages ? (
            <div
              ref={messageScrollRef}
              className="flex-1 overflow-y-auto pb-52 sm:pb-56"
            >
              <ChatMessages
                messages={activeMessages}
                chatTitle={chatTitle}
                isStreaming={isStreaming}
                error={error}
                activity={activity}
                scrollContainerRef={messageScrollRef}
                onEditMessage={handleEditMessage}
                onRetryMessage={handleRetryMessage}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pb-56 pt-[10vh] sm:px-6">
              <div className="w-full max-w-3xl">
                <Sparkles className="h-7 w-7 text-blue-700" />
                <h1 className="mt-4 text-3xl font-semibold text-gray-950">
                  今天想完成什么科研任务？
                </h1>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  直接描述任务。AI 会判断是否需要项目、文献或工具，并在执行前说明。
                </p>

                {projects.length > 0 && (
                  <section className="mt-8">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">
                      继续上次的项目
                    </h2>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {projects.slice(0, 4).map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          onClick={() => handleContinueProject(project)}
                          className="border border-gray-200 p-4 text-left hover:border-blue-400 hover:bg-blue-50"
                        >
                          <span className="block text-sm font-bold text-gray-950">
                            {project.name}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-gray-500">
                            {project.lastTask || "继续项目工作"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {folders.length > 0 && (
                  <section className="mt-6">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-gray-500">
                      常用文献文件夹
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {folders.slice(0, 6).map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => handleSelectFolder(folder)}
                          onDoubleClick={() => handleOpenFolder(folder)}
                          className="inline-flex items-center gap-2 border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:border-blue-400 hover:text-blue-800"
                        >
                          <FolderOpen className="h-4 w-4 text-amber-500" />
                          {folder.name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {error && <p className="mt-5 text-sm text-red-600">{error}</p>}
              </div>
            </div>
          )}

          {pendingProjectPayload && (
            <div className="absolute inset-x-4 bottom-52 z-30 mx-auto max-w-3xl border border-blue-200 bg-blue-50 p-4 shadow-lg sm:bottom-56">
              <p className="text-sm font-bold text-blue-950">
                这项任务会持续使用所选文献，建议创建科研项目
              </p>
              <p className="mt-1 text-xs leading-5 text-blue-800">
                创建后会保存项目与聊天关系，下一次可直接继续。临时任务不会绑定项目上下文。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={confirmCreateProject}
                  className="bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800"
                >
                  创建项目并开始
                </button>
                <button
                  type="button"
                  onClick={sendAsTemporary}
                  className="border border-blue-300 bg-white px-4 py-2 text-xs font-bold text-blue-800 hover:bg-blue-100"
                >
                  作为临时任务
                </button>
              </div>
            </div>
          )}

          {pendingTemporaryPayload && (
            <div className="absolute inset-x-4 bottom-52 z-30 mx-auto max-w-3xl border border-amber-200 bg-amber-50 p-4 shadow-lg sm:bottom-56">
              <p className="text-sm font-bold text-amber-950">
                这个问题将作为临时问题回答
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                AI 判断它可能与“{activeProject?.name}”无关，因此默认不读取项目文献，也不会写入项目记录。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={answerInsideProject}
                  className="bg-amber-700 px-4 py-2 text-xs font-bold text-white hover:bg-amber-800"
                >
                  将此问题加入当前项目
                </button>
                <span className="self-center text-[11px] text-amber-700">
                  不操作将自动继续
                </span>
              </div>
            </div>
          )}

          <ChatInput
            onSend={handleSend}
            onStop={() => abortControllerRef.current?.abort()}
            isStreaming={isStreaming}
            modelTier={modelTier}
            onModelTierChange={handleModelTierChange}
            webSearch={webSearch}
            useLibrary={useLibrary}
            onWebSearchChange={handleWebSearchChange}
            onUseLibraryChange={handleUseLibraryChange}
            memory={memory}
            onMemoryChange={handleMemoryChange}
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectChange={(projectId) => {
              if (!projectId) {
                handleNewChat();
                return;
              }
              const project = projects.find((item) => item.id === projectId);
              if (project) handleContinueProject(project);
            }}
            onNewProject={handleNewChat}
            selectedFolders={selectedFolders}
            onRemoveFolder={(folderId) =>
              setSelectedFolderIds((current) =>
                current.filter((id) => id !== folderId),
              )
            }
            onFolderDrop={handleFolderDrop}
          />
          {usage.total > 0 && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 text-[10px] text-gray-400">
              本次会话约 {usage.total.toLocaleString()} tokens
            </div>
          )}
        </main>
      </div>

      <ResearchToolPanel
        open={toolPanelOpen}
        folder={activeToolFolder}
        papers={toolPapers}
        isStreaming={isStreaming}
        activity={activity}
        onClose={() => setToolPanelOpen(false)}
      />
    </div>
  );
}
