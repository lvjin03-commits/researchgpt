"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  BookOpenText,
  ExternalLink,
  FileText,
  FolderOpen,
  LoaderCircle,
  PanelRightOpen,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { ChatInput, type ChatSendPayload } from "@/components/chat-input";
import { ChatMessages } from "@/components/chat-messages";
import { DesktopConnectionStatus } from "@/components/desktop-connection-status";
import { MenuIcon } from "@/components/icons";
import { ProjectTranslationDialog } from "@/components/project-translation-dialog";
import { ResearchToolPanel } from "@/components/research-tool-panel";
import { Sidebar } from "@/components/sidebar";
import type { ChatMessage } from "@/lib/ai/types";
import {
  DEFAULT_CHAT_MODEL_TIER,
  getChatModelOption,
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
import {
  fetchCloudWorkspace,
  upsertCloudWorkspace,
} from "@/lib/chat/workspace-cloud-sync";
import {
  openDesktopLocalPdf,
  readDesktopLocalPdf,
  type LocalFolderBinding,
  type LocalPdfFile,
} from "@/lib/desktop/connection";
import type { OutputMode } from "@/lib/translation/types";
import {
  createLiteratureFolder,
  deleteLiteratureFolder,
  deleteLiteraturePaper,
  fetchLiteratureLibrary,
  setPaperFolders,
  updateLiteratureFolder,
  uploadLocalPdfToLibrary,
} from "@/lib/literature/client";
import {
  planLibraryCommand,
  type LibraryCommandPlan,
} from "@/lib/chat/library-command";
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

function localFileKind(file: LocalPdfFile): string {
  if (file.kind) return file.kind;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "pdf";
  if (extension === "doc" || extension === "docx") return "word";
  if (extension === "xls" || extension === "xlsx") return "excel";
  if (extension === "ppt" || extension === "pptx") return "ppt";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(extension)) {
    return "image";
  }
  if (["txt", "md", "json", "csv", "tsv"].includes(extension)) return "text";
  return "file";
}

function localFileTypeLabel(file: LocalPdfFile): string {
  const labels: Record<string, string> = {
    pdf: "PDF",
    word: "Word",
    excel: "Excel",
    ppt: "PPT",
    image: "图片",
    text: "文本",
    file: "文件",
  };
  return labels[localFileKind(file)] ?? "文件";
}

function localFileExtension(file: LocalPdfFile): string {
  const rawExtension = file.extension || file.name.split(".").pop() || "";
  const extension = rawExtension.toLowerCase().trim();
  return extension.startsWith(".") ? extension : `.${extension}`;
}

function localFileReadBlockReason(file: LocalPdfFile): string | null {
  const extension = localFileExtension(file);
  if (extension === ".doc") {
    return "旧版 .doc 文件无法稳定识别，请用 Word 或 WPS 另存为 .docx 后再读取。";
  }
  if (extension === ".ppt") {
    return "旧版 .ppt 文件无法稳定识别，请用 PowerPoint 或 WPS 另存为 .pptx 后再读取。";
  }
  if (file.readable === false) {
    return "当前文件类型暂不支持全文读取，可以先打开文件查看。";
  }
  return null;
}

function isLocalDocxFile(file: LocalPdfFile): boolean {
  return localFileExtension(file) === ".docx";
}

function formatLocalFileReadError(file: LocalPdfFile, error: unknown): string {
  const blockedReason = localFileReadBlockReason(file);
  if (blockedReason) return `读取失败：${blockedReason}`;

  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("This file type is not readable yet") ||
    message.toLowerCase().includes("legacy .doc")
  ) {
    return "读取失败：旧版 Office 文件无法稳定识别，请先另存为 .docx 或 .pptx 后再读取。";
  }

  return error instanceof Error
    ? `读取失败：${error.message}。请确认文件没有损坏，并先启用 ResearchGPT 本机连接器。`
    : "读取失败，请确认文件没有损坏，并先启用 ResearchGPT 本机连接器。";
}

function buildLocalPdfManifest(project: ResearchProject): string {
  const files = project.localFolders.flatMap((folder) =>
    folder.files.map(
      (file) => `${folder.name} / ${file.name}（${localFileTypeLabel(file)}）`,
    ),
  );
  if (files.length === 0) return "";
  return [
    `当前项目“${project.name}”绑定的本地文件如下：`,
    ...files.map((file, index) => `${index + 1}. ${file}`),
  ].join("\n");
}

async function buildLocalPdfContextForProject(
  project: ResearchProject,
  onProgress: (message: string) => void,
  options: {
    selectedFileIds?: string[];
    scopeLabel?: string;
  } = {},
): Promise<ChatMessage[]> {
  const selectedFileIds = new Set(options.selectedFileIds ?? []);
  const allFiles = project.localFolders.flatMap((folder) =>
    folder.files.map((file) => ({ folderName: folder.name, file })),
  );
  const files =
    selectedFileIds.size > 0
      ? allFiles.filter((item) => selectedFileIds.has(item.file.id))
      : allFiles;
  if (files.length === 0) return [];

  const maxFiles = 30;
  const filesToRead = files.slice(0, maxFiles);
  const maxCharsTotal = 150000;
  const maxCharsPerFile = Math.max(
    4500,
    Math.min(18000, Math.floor(maxCharsTotal / Math.max(filesToRead.length, 1))),
  );
  let usedChars = 0;
  const evidenceMessages: ChatMessage[] = [];
  const failed: string[] = [];
  const skipped = files.slice(maxFiles).map(({ folderName, file }) => ({
    folderName,
    name: file.name,
  }));

  for (const [index, item] of filesToRead.entries()) {
    onProgress(
      `正在读取当前项目本地文件：${index + 1}/${filesToRead.length} ${item.file.name}`,
    );
    try {
      const result = await readDesktopLocalPdf(item.file);
      const remaining = maxCharsTotal - usedChars;
      if (remaining <= 0) {
        skipped.push({ folderName: item.folderName, name: item.file.name });
        continue;
      }
      const text = result.text.slice(0, Math.min(maxCharsPerFile, remaining));
      usedChars += text.length;
      evidenceMessages.push({
        role: "user",
        content: [
          `【本地文件证据包 ${evidenceMessages.length + 1}/${filesToRead.length}】`,
          `文件夹：${item.folderName}`,
          `文件名：${result.name}`,
          `页数：${result.pageCount}`,
          `原始可读字符数：${result.charCount}${result.truncated ? "（本机连接器已截取）" : ""}`,
          `本次送入模型字符数：${text.length}${text.length < result.text.length ? "（为控制成本已截取）" : ""}`,
          "正文内容/摘录：",
          text,
        ].join("\n"),
      });
    } catch (error) {
      failed.push(
        `${item.folderName} / ${item.file.name}：${
          error instanceof Error ? error.message : "读取失败"
        }`,
      );
    }
  }

  const summary = [
    "【当前项目本地文件上下文】",
        "用户已经授权 ResearchGPT 本机连接器读取当前项目绑定的本地文件夹。回答项目相关问题时，必须优先且只使用这些本地文件证据；不要把旧聊天、其他项目或其他文献库文件夹当成本次证据。",
    options.scopeLabel ? `本次资料范围：${options.scopeLabel}` : "",
    selectedFileIds.size > 0
      ? "用户已经在项目资料树中选中了部分文件。本次回答默认只分析这些选中的文件；除非用户明确要求全部文件，否则不要扩展到项目内其他文件。"
      : "用户没有选中特定文件。本次回答默认分析当前项目绑定的全部本地文件。",
    "用户的表达不需要是固定口令。只要含义是精读、拆解、分析、比较、整理、生成矩阵、生成 PPT、大纲规划等，都要映射到当前项目资料范围执行。",
    "如果用户问“是否必须上传文件”或“你能不能读取本地文件夹”，必须说明：在本机连接器在线且用户已绑定/授权本地文件夹时，可以读取本地文件夹里的 PDF、Word、Excel、PPT、文本等文件；图片可打开和纳入范围，但图片内容识别需要 OCR/视觉模型。只有网页端单独运行、本机连接器离线、文件未授权或读取失败时，才需要用户上传或重新授权。",
    "如果用户要求分析“当前项目所有文件”，必须先按下方清单识别当前项目文件范围，不要回答成文献库、旧项目或其他文件夹中的文献。",
    buildLocalPdfManifest(project),
    evidenceMessages.length > 0
      ? `已成功从授权本地文件夹读取 ${evidenceMessages.length} 个文件的正文/摘录。本次总计送入模型约 ${usedChars} 个字符，覆盖 ${evidenceMessages.length}/${files.length} 个文件。后续证据包均来自这个项目。`
      : "没有成功读取到本地文件正文。",
    failed.length > 0
      ? `以下文件读取失败，不能作为已读全文证据：\n${failed
          .map((item, index) => `${index + 1}. ${item}`)
          .join("\n")}`
      : "",
    skipped.length > 0
      ? `为控制单次分析成本，本次未读取以下文件。若用户要求“全部文献”，请明确说明本次最多读取前 ${maxFiles} 个，并建议分批分析：\n${skipped
          .map((item, index) => `${index + 1}. ${item.folderName} / ${item.name}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      role: "system",
      content: summary,
    },
    ...evidenceMessages,
  ];
}

function projectNameFromTask(
  message: string,
  folders: LiteratureFolder[],
): string {
  if (folders.length === 1) return folders[0].name;
  if (folders.length > 1) return `${folders[0].name} 等文献研究`;
  return message.trim().slice(0, 28) || "新科研项目";
}

function shouldAnalyzeAllProjectFiles(message: string): boolean {
  return /(全部|所有|整个项目|整個項目|全项目|全項目|所有文件|所有文献|全部文献|全部论文|all|every|entire project|whole project)/i.test(
    message,
  );
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
  const [usage, setUsage] = useState({
    input: 0,
    cachedInput: 0,
    output: 0,
    reasoning: 0,
    total: 0,
    costUsd: 0,
    webSearchCalls: 0,
    codeInterpreterCalls: 0,
  });
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
  const [selectedLocalFileIds, setSelectedLocalFileIds] = useState<string[]>(
    [],
  );
  const [contextMode, setContextMode] =
    useState<WorkspaceContextMode>("auto");
  const [pendingProjectPayload, setPendingProjectPayload] =
    useState<ChatSendPayload | null>(null);
  const [pendingTemporaryPayload, setPendingTemporaryPayload] =
    useState<ChatSendPayload | null>(null);
  const [newProjectDialogOpen, setNewProjectDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingLibraryCommand, setPendingLibraryCommand] = useState<{
    payload: ChatSendPayload;
    plan: LibraryCommandPlan;
  } | null>(null);
  const [pendingProjectTranslation, setPendingProjectTranslation] = useState<{
    files: LocalPdfFile[];
    outputMode: OutputMode;
  } | null>(null);
  const [isExecutingLibraryCommand, setIsExecutingLibraryCommand] =
    useState(false);
  const [busyLibraryPaperId, setBusyLibraryPaperId] = useState<string | null>(
    null,
  );
  const [isUploadingToFolder, setIsUploadingToFolder] = useState(false);
  const [libraryOperationMessage, setLibraryOperationMessage] = useState<
    string | null
  >(null);
  const [libraryOperationError, setLibraryOperationError] = useState<
    string | null
  >(null);
  const [localPdfStatus, setLocalPdfStatus] = useState<string | null>(null);
  const [activeLocalPdfAction, setActiveLocalPdfAction] = useState<
    string | null
  >(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const workspaceCloudEnabledRef = useRef(true);
  const workspaceSyncTimerRef = useRef<number | null>(null);

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

  const reloadLibrary = useCallback(async () => {
    const result = await fetchLiteratureLibrary(CHAT_LIBRARY_FILTERS);
    setFolders(result.folders);
    setLibraryPapers(result.papers);
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;

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

    async function hydrateWorkspace() {
      const localWorkspace = loadWorkspace();
      let workspace = localWorkspace;

      try {
        const cloudWorkspace = await fetchCloudWorkspace();
        if (cancelled) return;

        if (cloudWorkspace) {
          workspace = cloudWorkspace;
        } else if (localWorkspace.projects.length > 0) {
          await upsertCloudWorkspace(localWorkspace);
          workspace = localWorkspace;
        }

        workspaceCloudEnabledRef.current = true;
      } catch (error) {
        console.error("[workspace] Cloud sync unavailable:", error);
        workspaceCloudEnabledRef.current = false;
        workspace = localWorkspace;
      }

      if (cancelled) return;

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
      saveWorkspace(workspace);
      setWorkspaceHydrated(true);
    }

    void hydrateWorkspace();

    void fetchLiteratureLibrary(CHAT_LIBRARY_FILTERS)
      .then((result) => {
        setFolders(result.folders);
        setLibraryPapers(result.papers);
      })
      .catch(() => {
        setError("文献文件夹加载失败，可刷新页面后重试。");
      });

    return () => {
      cancelled = true;
      if (workspaceSyncTimerRef.current) {
        window.clearTimeout(workspaceSyncTimerRef.current);
        workspaceSyncTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    const workspace = { projects, activeProjectId };
    saveWorkspace(workspace);

    if (!workspaceCloudEnabledRef.current) return;

    if (workspaceSyncTimerRef.current) {
      window.clearTimeout(workspaceSyncTimerRef.current);
    }

    workspaceSyncTimerRef.current = window.setTimeout(() => {
      void upsertCloudWorkspace(workspace).catch((error) => {
        console.error("[workspace] Cloud sync failed:", error);
        workspaceCloudEnabledRef.current = false;
      });
    }, 800);
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
  const activeProjectLocalPdfCount = useMemo(
    () =>
      activeProject?.localFolders.reduce(
        (total, folder) => total + (folder.fileCount ?? folder.files.length),
        0,
      ) ?? 0,
    [activeProject],
  );
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
    if (tier === modelTier) return;
    const option = getChatModelOption(tier);
    if (
      option.expensive &&
      !window.confirm(
        option.costWarning ??
          "该模型成本较高。确认继续使用这个模型吗？",
      )
    ) {
      return;
    }
    setModelTier(tier);
    window.localStorage.setItem("researchgpt-chat-model-tier", tier);
  }, [modelTier]);
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
    setSelectedLocalFileIds([]);
    setContextMode("auto");
    setPendingProjectPayload(null);
    setPendingTemporaryPayload(null);
    setPendingLibraryCommand(null);
    startNewChat();
  }, [abortActiveStream, startNewChat]);

  const openNewProjectDialog = useCallback(() => {
    setNewProjectName("");
    setNewProjectDialogOpen(true);
  }, []);

  const createBlankProject = useCallback(() => {
    const name = newProjectName.trim();
    if (!name) return;
    abortActiveStream();
    const inheritedFolderIds = activeProject ? [] : selectedFolderIds;
    const project = createResearchProject(
      name,
      inheritedFolderIds,
      "等待开始工作",
    );
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setSelectedFolderIds(inheritedFolderIds);
    setSelectedLocalFileIds([]);
    setContextMode("project");
    setPendingProjectPayload(null);
    setPendingTemporaryPayload(null);
    setError(null);
    startNewChat();
    setNewProjectDialogOpen(false);
    setNewProjectName("");
  }, [
    abortActiveStream,
    activeProject,
    newProjectName,
    selectedFolderIds,
    startNewChat,
  ]);

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
      setSelectedLocalFileIds([]);
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

  const handleDeleteProject = useCallback(
    (project: ResearchProject) => {
      const message = [
        `确定删除项目“${project.name}”吗？`,
        "这只会删除项目记录和资料绑定，不会删除聊天记录、文献库 PDF 或本地文件。",
      ].join("\n");
      if (!window.confirm(message)) return;

      abortActiveStream();
      setProjects((current) => current.filter((item) => item.id !== project.id));
      if (activeProjectId === project.id) {
        setActiveProjectId(null);
        setSelectedFolderIds([]);
        setSelectedLocalFileIds([]);
        setContextMode("auto");
        setActiveToolFolderId(null);
        setToolPanelOpen(false);
      }
      setPendingProjectPayload(null);
      setPendingTemporaryPayload(null);
      setError(null);
    },
    [abortActiveStream, activeProjectId],
  );

  const handleRenameProject = useCallback((project: ResearchProject) => {
    const nextName = window.prompt("请输入新的项目名称", project.name)?.trim();
    if (!nextName || nextName === project.name) return;

    const now = new Date().toISOString();
    setProjects((current) =>
      current.map((item) =>
        item.id === project.id
          ? {
              ...item,
              name: nextName.slice(0, 80),
              updatedAt: now,
            }
          : item,
      ),
    );
  }, []);

  const handleContinueProject = useCallback(
    (project: ResearchProject) => {
      setActiveProjectId(project.id);
      setSelectedFolderIds(project.folderIds);
      setSelectedLocalFileIds([]);
      setContextMode("project");
      setUseLibrary(project.folderIds.length > 0);
      if (project.conversationId) selectConversation(project.conversationId);
      else startNewChat();
      if (project.folderIds[0]) {
        setActiveToolFolderId(project.folderIds[0]);
        setToolPanelOpen(true);
      } else {
        setActiveToolFolderId(null);
        setToolPanelOpen(true);
      }
    },
    [selectConversation, startNewChat],
  );

  const handleBindLocalFolder = useCallback(
    (folder: LocalFolderBinding) => {
      const boundFileCount = folder.fileCount ?? folder.files.length;
      if (!activeProjectId) {
        const project = createResearchProject(
          folder.name || "本地文献项目",
          [],
          `已绑定本地资料文件夹：${folder.name}（${boundFileCount} 个文件）`,
        );
        const projectWithLocalFolder = {
          ...project,
          localFolders: [folder],
        };
        setProjects((current) => [projectWithLocalFolder, ...current]);
        setActiveProjectId(projectWithLocalFolder.id);
        setSelectedFolderIds([]);
        setSelectedLocalFileIds([]);
        setContextMode("project");
        setError(null);
        setLocalPdfStatus(
          `已创建项目并绑定本地文件夹：${folder.name}（${boundFileCount} 个文件）`,
        );
        setActiveToolFolderId(null);
        setToolPanelOpen(true);
        startNewChat();
        return;
      }

      const now = new Date().toISOString();
      setProjects((current) =>
        current.map((project) => {
          if (project.id !== activeProjectId) return project;
          const existing = project.localFolders.filter(
            (item) => item.id !== folder.id,
          );
          return {
            ...project,
            localFolders: [folder, ...existing].slice(0, 12),
            lastTask: `已绑定本地资料文件夹：${folder.name}（${boundFileCount} 个文件）`,
            updatedAt: now,
          };
        }),
      );
      setContextMode("project");
      setError(null);
      setActiveToolFolderId(null);
      setToolPanelOpen(true);
    },
    [activeProjectId, selectedFolderIds, startNewChat],
  );

  const handleOpenLocalPdf = useCallback(async (file: LocalPdfFile) => {
    setActiveLocalPdfAction(`open:${file.id}`);
    setLocalPdfStatus(null);
    try {
      await openDesktopLocalPdf(file);
      setLocalPdfStatus(`已通过本机打开：${file.name}`);
    } catch (error) {
      setLocalPdfStatus(
        error instanceof Error
          ? `打开失败：${error.message}。请先启用 ResearchGPT 本机连接器。`
          : "打开失败，请先启用 ResearchGPT 本机连接器。",
      );
    } finally {
      setActiveLocalPdfAction(null);
    }
  }, []);

  const handleReadLocalPdf = useCallback(async (file: LocalPdfFile) => {
    setActiveLocalPdfAction(`read:${file.id}`);
    setLocalPdfStatus(null);
    try {
      const result = await readDesktopLocalPdf(file);
      setLocalPdfStatus(
        `已读取《${result.name}》：${result.pageCount} 页，${result.charCount} 字符${
          result.truncated ? "，已截取预览文本" : ""
        }。`,
      );
    } catch (error) {
      setLocalPdfStatus(formatLocalFileReadError(file, error));
    } finally {
      setActiveLocalPdfAction(null);
    }
  }, []);

  const handleToggleLocalFile = useCallback((fileId: string) => {
    setSelectedLocalFileIds((current) =>
      current.includes(fileId)
        ? current.filter((id) => id !== fileId)
        : [...current, fileId],
    );
  }, []);

  const handleToggleLocalFolder = useCallback(
    (folder: LocalFolderBinding) => {
      const folderFileIds = folder.files.map((file) => file.id);
      setSelectedLocalFileIds((current) => {
        const currentSet = new Set(current);
        const allSelected = folderFileIds.every((id) => currentSet.has(id));
        if (allSelected) {
          return current.filter((id) => !folderFileIds.includes(id));
        }
        for (const id of folderFileIds) currentSet.add(id);
        return [...currentSet];
      });
    },
    [],
  );

  const handleClearLocalFileSelection = useCallback(() => {
    setSelectedLocalFileIds([]);
  }, []);

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

  const handleCreateSidebarFolder = useCallback(
    async (name: string) => {
      const folder = await createLiteratureFolder({ name });
      setFolders((current) => [...current, folder]);
      return folder;
    },
    [],
  );

  const handleFolderDrop = useCallback((folderId: string) => {
    setSelectedFolderIds((current) =>
      current.includes(folderId) ? current : [...current, folderId],
    );
    setUseLibrary(true);
  }, []);

  const handlePaperDrop = useCallback(
    async (paperId: string, folderId: string) => {
      const paper = libraryPapers.find((item) => item.id === paperId);
      const targetFolder = folders.find((item) => item.id === folderId);
      if (!paper || !targetFolder || busyLibraryPaperId) return;
      if (
        paper.folderIds?.length === 1 &&
        paper.folderIds[0] === folderId
      ) {
        setLibraryOperationError(
          `“${paper.title}”已经在“${targetFolder.name}”中。`,
        );
        return;
      }

      setBusyLibraryPaperId(paperId);
      setLibraryOperationError(null);
      setLibraryOperationMessage(null);
      try {
        await setPaperFolders(paperId, [folderId]);
        await reloadLibrary();
        setActiveToolFolderId(folderId);
        setToolPanelOpen(true);
        setLibraryOperationMessage(
          `已将“${paper.title}”移动到“${targetFolder.name}”。`,
        );
      } catch (caught) {
        setLibraryOperationError(
          caught instanceof Error
            ? `移动失败：${caught.message}`
            : "移动失败，请重试。",
        );
      } finally {
        setBusyLibraryPaperId(null);
      }
    },
    [
      busyLibraryPaperId,
      folders,
      libraryPapers,
      reloadLibrary,
    ],
  );

  const handleRemovePaperFromOpenFolder = useCallback(
    async (paper: LiteraturePaper) => {
      if (!activeToolFolderId || busyLibraryPaperId) return;
      setBusyLibraryPaperId(paper.id);
      setLibraryOperationError(null);
      setLibraryOperationMessage(null);
      try {
        await setPaperFolders(
          paper.id,
          (paper.folderIds ?? []).filter((id) => id !== activeToolFolderId),
        );
        await reloadLibrary();
        setLibraryOperationMessage(`已将“${paper.title}”移出当前文件夹。`);
      } catch (caught) {
        setLibraryOperationError(
          caught instanceof Error
            ? `移出失败：${caught.message}`
            : "移出失败，请重试。",
        );
      } finally {
        setBusyLibraryPaperId(null);
      }
    },
    [activeToolFolderId, busyLibraryPaperId, reloadLibrary],
  );

  const handleUploadFilesToOpenFolder = useCallback(
    async (files: File[]) => {
      if (!activeToolFolderId || isUploadingToFolder || files.length === 0) {
        return;
      }
      setIsUploadingToFolder(true);
      setLibraryOperationError(null);
      setLibraryOperationMessage(null);
      let uploaded = 0;
      try {
        for (const file of files.slice(0, 10)) {
          await uploadLocalPdfToLibrary([activeToolFolderId], file);
          uploaded += 1;
          setLibraryOperationMessage(
            `正在上传 ${uploaded}/${Math.min(files.length, 10)}：${file.name}`,
          );
        }
        await reloadLibrary();
        setLibraryOperationMessage(`已上传 ${uploaded} 个 PDF 到当前文件夹。`);
      } catch (caught) {
        await reloadLibrary().catch(() => undefined);
        setLibraryOperationError(
          caught instanceof Error
            ? `已完成 ${uploaded} 个，后续上传失败：${caught.message}`
            : `已完成 ${uploaded} 个，后续上传失败。`,
        );
      } finally {
        setIsUploadingToFolder(false);
      }
    },
    [activeToolFolderId, isUploadingToFolder, reloadLibrary],
  );

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
      localFileIdsOverride?: string[],
    ) => {
      abortControllerRef.current?.abort();
      const project =
        projectOverride === undefined ? activeProject : projectOverride;
      const projectUsesLocalPdfs =
        project &&
        project.localFolders.length > 0 &&
        (contextModeOverride ?? contextMode) !== "temporary";
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
              folderIds: projectUsesLocalPdfs
                ? project.folderIds
                : selectedFolderIds,
              lastTask: payload.message,
              updatedAt: now,
            },
            ...without,
          ];
        });
        setActiveProjectId(project.id);
      }

      const shouldReadLocalProject = projectUsesLocalPdfs;
      const selectedLocalIdsForThisRequest =
        shouldReadLocalProject &&
        (localFileIdsOverride ?? selectedLocalFileIds).length > 0 &&
        !shouldAnalyzeAllProjectFiles(payload.message)
          ? (localFileIdsOverride ?? selectedLocalFileIds)
          : [];
      const historyForApi = shouldReadLocalProject ? history.slice(-4) : history;
      let apiMessages = buildChatApiMessages(
        historyForApi,
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
        if (shouldReadLocalProject) {
          const scopeLabel =
            selectedLocalIdsForThisRequest.length > 0
              ? `当前项目“${project.name}”中已选 ${selectedLocalIdsForThisRequest.length} 个文件`
              : `当前项目“${project.name}”绑定的全部本地文件`;
          const localPdfContextMessages = await buildLocalPdfContextForProject(
            project,
            setActivity,
            {
              selectedFileIds: selectedLocalIdsForThisRequest,
              scopeLabel,
            },
          );
          if (localPdfContextMessages.length > 0) {
            apiMessages = [
              ...apiMessages.slice(0, -1),
              ...localPdfContextMessages,
              apiMessages[apiMessages.length - 1],
            ];
          }
        }
        await streamChatResponse(apiMessages, {
          files: payload.files,
          signal: abortController.signal,
          modelTier,
          webSearch,
          useLibrary: shouldReadLocalProject ? false : useLibrary,
          memory,
          selectedFolderIds: shouldReadLocalProject ? [] : selectedFolderIds,
          contextMode: contextModeOverride ?? contextMode,
          projectName: project?.name,
          onStatus: setActivity,
          onUsage: (nextUsage) =>
            setUsage((current) => ({
              input: current.input + nextUsage.inputTokens,
              cachedInput:
                current.cachedInput + nextUsage.cachedInputTokens,
              output: current.output + nextUsage.outputTokens,
              reasoning: current.reasoning + nextUsage.reasoningTokens,
              total: current.total + nextUsage.totalTokens,
              costUsd: current.costUsd + nextUsage.estimatedCostUsd,
              webSearchCalls:
                current.webSearchCalls + nextUsage.webSearchCalls,
              codeInterpreterCalls:
                current.codeInterpreterCalls +
                nextUsage.codeInterpreterCalls,
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
      selectedLocalFileIds,
      useLibrary,
      webSearch,
    ],
  );

  const handleRunLocalFileTask = useCallback(
    (
      action:
        | "single_read"
        | "analysis"
        | "matrix"
        | "translate_en"
        | "translate_bilingual",
      files: LocalPdfFile[],
    ) => {
      if (!activeProject || files.length === 0) return;

      if (action === "single_read" && files.length !== 1) {
        setError("单篇精读必须且只能选择 1 个文件。");
        return;
      }
      if (action === "matrix" && files.length < 2) {
        setError("文献矩阵至少需要选择 2 个文件。");
        return;
      }
      if (
        (action === "translate_en" || action === "translate_bilingual") &&
        files.length < 1
      ) {
        setError("文件翻译至少需要选择 1 个文件。");
        return;
      }

      if (action === "translate_en" || action === "translate_bilingual") {
        const unsupportedFiles = files.filter((file) => !isLocalDocxFile(file));
        if (unsupportedFiles.length > 0) {
          setLocalPdfStatus(
            `翻译功能会输出与原格式一致的 Word 文档。当前仅支持 .docx，请先将以下文件另存为 .docx：${unsupportedFiles
              .slice(0, 3)
              .map((file) => file.name)
              .join("、")}${unsupportedFiles.length > 3 ? " 等" : ""}`,
          );
          setError(null);
          return;
        }

        const fileIds = files.map((file) => file.id);
        setSelectedLocalFileIds(fileIds);
        setActiveToolFolderId(null);
        setToolPanelOpen(true);
        setContextMode("project");
        setError(null);
        setLocalPdfStatus(
          `准备翻译 ${files.length} 个 Word 文档，请确认翻译设置。完成后会提供下载链接。`,
        );
        setPendingProjectTranslation({
          files,
          outputMode:
            action === "translate_bilingual" ? "bilingual" : "replace",
        });
        return;
      }

      const fileIds = files.map((file) => file.id);
      setSelectedLocalFileIds(fileIds);
      setActiveToolFolderId(null);
      setToolPanelOpen(true);
      setContextMode("project");
      setError(null);

      const fileList = files
        .slice(0, 12)
        .map(
          (file, index) =>
            `${index + 1}. ${file.name}（${localFileTypeLabel(file)}）`,
        )
        .join("\n");
      const extra = files.length > 12 ? `\n...共 ${files.length} 个文件` : "";
      const taskMessage =
        action === "single_read"
          ? `单篇精读这个文件：\n${fileList}\n\n请按研究问题、技术路线、关键实验、结果证据、创新性、局限性、可引用观点来分析。`
          : action === "matrix"
            ? `基于当前选中的 ${files.length} 个文件生成中文文献矩阵。\n\n文献范围：\n${fileList}${extra}\n\n矩阵至少包含：文献名称、研究主题、研究问题、研究对象、研究方法、关键结果、主要结论、核心贡献、局限性、与当前项目的关系。`
            : `分析当前选中的 ${files.length} 个文件。\n\n文献范围：\n${fileList}${extra}\n\n请输出主题归类、研究共识、研究分歧、研究空白，以及后续可展开的文献矩阵建议。`;

      void submitMessage(
        { message: taskMessage },
        activeMessages,
        activeProject,
        "project",
        fileIds,
      );
    },
    [activeMessages, activeProject, submitMessage],
  );

  const persistLibraryExchange = useCallback(
    async (payload: ChatSendPayload, result: string) => {
      const nextMessages: DisplayChatMessage[] = [
        ...activeMessages,
        toDisplayUserMessage(payload),
        { role: "assistant", content: result },
      ];
      const conversationId = await ensureActiveConversation(nextMessages);
      persistConversation(conversationId, nextMessages);
      if (activeProject) {
        const now = new Date().toISOString();
        setProjects((current) =>
          current.map((project) =>
            project.id === activeProject.id
              ? {
                  ...project,
                  conversationId,
                  lastTask: payload.message,
                  updatedAt: now,
                }
              : project,
          ),
        );
      }
      await flushCloudSync();
    },
    [
      activeMessages,
      activeProject,
      ensureActiveConversation,
      flushCloudSync,
      persistConversation,
    ],
  );

  const executePendingLibraryCommand = useCallback(async () => {
    if (!pendingLibraryCommand || isExecutingLibraryCommand) return;
    const { payload, plan } = pendingLibraryCommand;
    setIsExecutingLibraryCommand(true);
    setError(null);

    try {
      let focusFolderId: string | null = null;
      switch (plan.kind) {
        case "create_folder": {
          const folder = await createLiteratureFolder({
            name: plan.folderName,
          });
          focusFolderId = folder.id;
          break;
        }
        case "rename_folder":
          await updateLiteratureFolder(plan.folderId, plan.nextName);
          focusFolderId = plan.folderId;
          break;
        case "delete_folder":
          await deleteLiteratureFolder(plan.folderId);
          setSelectedFolderIds((current) =>
            current.filter((id) => id !== plan.folderId),
          );
          setProjects((current) =>
            current.map((project) => ({
              ...project,
              folderIds: project.folderIds.filter((id) => id !== plan.folderId),
            })),
          );
          if (activeToolFolderId === plan.folderId) {
            setActiveToolFolderId(null);
            setToolPanelOpen(false);
          }
          break;
        case "delete_paper":
          await deleteLiteraturePaper(plan.paperId);
          break;
        case "move_paper":
          await setPaperFolders(plan.paperId, [plan.folderId]);
          focusFolderId = plan.folderId;
          break;
        case "add_paper_to_folder":
          await setPaperFolders(plan.paperId, [
            ...new Set([...plan.currentFolderIds, plan.folderId]),
          ]);
          focusFolderId = plan.folderId;
          break;
        case "remove_paper_from_folder":
          await setPaperFolders(
            plan.paperId,
            plan.currentFolderIds.filter((id) => id !== plan.folderId),
          );
          focusFolderId = plan.folderId;
          break;
      }

      await reloadLibrary();
      if (focusFolderId) {
        setActiveToolFolderId(focusFolderId);
        setToolPanelOpen(true);
      }
      await persistLibraryExchange(
        payload,
        `已执行文献库操作：**${plan.summary}**。\n\n右侧文献工作台和文献库数据已同步刷新。`,
      );
      setPendingLibraryCommand(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `文献库操作失败：${caught.message}`
          : "文献库操作失败，请重试。",
      );
    } finally {
      setIsExecutingLibraryCommand(false);
    }
  }, [
    activeToolFolderId,
    isExecutingLibraryCommand,
    pendingLibraryCommand,
    persistLibraryExchange,
    reloadLibrary,
  ]);

  const handleSend = useCallback(
    (payload: ChatSendPayload) => {
      if (!payload.files?.length) {
        const command = planLibraryCommand(
          payload.message,
          folders,
          libraryPapers,
        );
        if (command.type === "error") {
          setError(command.message);
          return;
        }
        if (command.type === "plan") {
          setError(null);
          setPendingProjectPayload(null);
          setPendingTemporaryPayload(null);
          setPendingLibraryCommand({ payload, plan: command.plan });
          return;
        }
      }
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
    [
      activeProject,
      folders,
      libraryPapers,
      selectedFolderIds.length,
      submitMessage,
    ],
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
      <div className="research-canvas flex h-dvh items-center justify-center text-sm text-[#607078]">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin text-[#245d82]" />
        正在准备科研工作台…
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f4f7f8]">
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
        onNewProject={openNewProjectDialog}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onSelectFolder={handleSelectFolder}
        onOpenFolder={handleOpenFolder}
        onCreateFolder={handleCreateSidebarFolder}
        onPaperDrop={(paperId, folderId) =>
          void handlePaperDrop(paperId, folderId)
        }
        onContinueProject={handleContinueProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        syncError={syncError}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#dbe4e7] bg-white/95 px-4 backdrop-blur sm:px-5">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="p-2 text-gray-600 hover:bg-gray-100 md:hidden"
            aria-label="打开侧栏"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#172126]">
              {activeProject?.name || chatTitle}
            </p>
            <p className="truncate text-[11px] font-medium text-[#718087]">
              {contextMode === "temporary"
                ? "临时问题，不使用项目上下文"
                : activeProjectLocalPdfCount > 0
                  ? `本地文件夹 ${activeProject?.localFolders.length ?? 0} 个 · 文件 ${activeProjectLocalPdfCount} 个`
                : selectedFolders.length > 0
                  ? `已选择 ${selectedFolders.length} 个文献文件夹`
                  : "可直接绑定本地文件夹或选择项目资料"}
            </p>
          </div>
          <div className="ml-auto">
            <DesktopConnectionStatus compact />
          </div>
          {!toolPanelOpen && (
            <button
              type="button"
              onClick={() => setToolPanelOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#cddadd] bg-white px-3 text-xs font-bold text-[#42545c] hover:border-[#8eabb8] hover:bg-[#f1f6f8]"
            >
              <PanelRightOpen className="h-4 w-4" />
              工作台
            </button>
          )}
        </header>

        <main className="research-canvas relative flex flex-1 flex-col overflow-hidden">
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
            <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pb-72 pt-10 sm:px-8 sm:pb-80 sm:pt-[9vh]">
              <div className="w-full max-w-4xl">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[#e5eff3] text-[#174866]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="research-eyebrow mt-5">Research command center</p>
                <h1 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight text-[#172126] sm:text-4xl">
                  今天想完成什么科研任务？
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#607078]">
                  直接描述目标，或选中文献资料。系统会识别任务、调用合适工具，并在修改数据前向你确认。
                </p>

                {projects.length > 0 && (
                  <section className="mt-9">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="research-eyebrow">Projects</p>
                        <h2 className="mt-1 text-sm font-bold text-[#26353b]">
                      继续上次的项目
                        </h2>
                      </div>
                      <button type="button" onClick={openNewProjectDialog} className="text-xs font-bold text-[#245d82] hover:text-[#174866]">
                        新建项目
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {projects.slice(0, 4).map((project) => (
                        <div
                          key={project.id}
                          className="research-surface group relative rounded-md p-4 pr-20 transition hover:border-[#8eabb8] hover:bg-[#f8fbfc]"
                        >
                        <button
                          type="button"
                          onClick={() => handleContinueProject(project)}
                          className="block w-full text-left"
                        >
                          <span className="block text-sm font-bold text-[#172126]">
                            {project.name}
                          </span>
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#718087]">
                            {project.lastTask || "继续项目工作"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRenameProject(project)}
                          aria-label={`重命名项目 ${project.name}`}
                          title="重命名项目"
                          className="absolute right-12 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#7c8b91] opacity-0 hover:bg-[#e8f2f6] hover:text-[#174866] group-hover:opacity-100 focus:opacity-100"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteProject(project)}
                          aria-label={`删除项目 ${project.name}`}
                          title="删除项目"
                          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#7c8b91] opacity-0 hover:bg-red-50 hover:text-red-700 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      ))}
                    </div>
                  </section>
                )}

                {activeProject && activeProject.localFolders.length > 0 && (
                  <section className="mt-7 border-t border-[#dbe4e7] pt-6">
                    <p className="research-eyebrow">Local literature</p>
                    <h2 className="mt-1 text-sm font-bold text-[#26353b]">
                      当前项目绑定的本地文献
                    </h2>
                    {localPdfStatus && (
                      <p className="mt-3 rounded-md border border-[#cfe0e7] bg-[#f6fbfd] px-3 py-2 text-xs font-semibold text-[#245d82]">
                        {localPdfStatus}
                      </p>
                    )}
                    <div className="mt-3 grid gap-3">
                      {activeProject.localFolders.map((folder) => (
                        <div
                          key={folder.id}
                          className="rounded-md border border-[#d4dfe2] bg-white px-3 py-3 text-sm shadow-[0_1px_1px_rgba(26,47,56,0.03)]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-bold text-[#26353b]">
                                {folder.name}
                              </p>
                              <p className="truncate text-xs font-medium text-[#52636b]">
                                {folder.path}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-md bg-[#e8f2f6] px-2 py-1 text-xs font-bold text-[#245d82]">
                              {folder.fileCount ?? folder.files.length} 文件
                            </span>
                          </div>
                          {folder.files.length > 0 ? (
                            <div className="mt-3 divide-y divide-[#e4ecef] rounded-md border border-[#e4ecef]">
                              {folder.files.slice(0, 8).map((file) => {
                                const readBlockReason =
                                  localFileReadBlockReason(file);
                                return (
                                <div
                                  key={file.id}
                                  className="flex items-center gap-3 px-3 py-2"
                                >
                                  <FileText className="h-4 w-4 shrink-0 text-[#245d82]" />
                                  <span className="min-w-0 flex-1 truncate text-xs font-bold text-[#172126]">
                                    {file.name}
                                    <span className="ml-2 rounded bg-[#eef4f6] px-1.5 py-0.5 text-[10px] text-[#52636b]">
                                      {localFileTypeLabel(file)}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void handleOpenLocalPdf(file)}
                                    disabled={
                                      activeLocalPdfAction ===
                                      `open:${file.id}`
                                    }
                                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-[#9fb7c2] bg-white px-2 text-xs font-bold text-[#26353b] hover:bg-[#f1f6f8] disabled:opacity-60"
                                  >
                                    {activeLocalPdfAction ===
                                    `open:${file.id}` ? (
                                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    )}
                                    打开
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleReadLocalPdf(file)}
                                    disabled={
                                      Boolean(readBlockReason) ||
                                      activeLocalPdfAction ===
                                      `read:${file.id}`
                                    }
                                    title={readBlockReason ?? "可以读取正文，点击测试读取"}
                                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-[#12314a] px-2 text-xs font-bold text-white hover:bg-[#0b2235] disabled:bg-[#dce5e8] disabled:text-[#63757d] disabled:opacity-100"
                                  >
                                    {readBlockReason ? (
                                      "不可读取"
                                    ) : activeLocalPdfAction ===
                                      `read:${file.id}` ? (
                                      <>
                                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                        读取中
                                      </>
                                    ) : (
                                      <>
                                        <BookOpenText className="h-3.5 w-3.5" />
                                        可读取
                                      </>
                                    )}
                                  </button>
                                </div>
                              );
                              })}
                            </div>
                          ) : (
                            <p className="mt-3 rounded-md bg-[#f8fbfc] px-3 py-2 text-xs font-semibold text-[#718087]">
                              这个文件夹中暂未扫描到可用文件。
                            </p>
                          )}
                          {folder.files.length > 8 && (
                            <p className="mt-2 text-xs font-medium text-[#718087]">
                              仅显示前 8 个文件，后续会加入完整文件列表和搜索。
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {folders.length > 0 && (
                  <section className="mt-7 border-t border-[#dbe4e7] pt-6">
                    <p className="research-eyebrow">Literature context</p>
                    <h2 className="mt-1 text-sm font-bold text-[#26353b]">
                      常用文献文件夹
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {folders.slice(0, 6).map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => handleSelectFolder(folder)}
                          onDoubleClick={() => handleOpenFolder(folder)}
                          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[#d4dfe2] bg-white px-3 py-2 text-sm font-semibold text-[#42545c] shadow-[0_1px_1px_rgba(26,47,56,0.03)] hover:border-[#8eabb8] hover:text-[#174866]"
                        >
                          <FolderOpen className="h-4 w-4 text-[#a56518]" />
                          <span>{folder.name}</span>
                          <span className="border-l border-[#dbe4e7] pl-2 text-[11px] font-medium text-[#7c8b91]">
                            {folderCounts[folder.id] ?? 0} 篇
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {error && <p className="mt-5 text-sm text-red-600">{error}</p>}
              </div>
            </div>
          )}

          {pendingLibraryCommand && (
            <div
              className={`absolute inset-x-4 bottom-52 z-40 mx-auto max-w-3xl border p-4 shadow-lg sm:bottom-56 ${
                pendingLibraryCommand.plan.destructive
                  ? "border-red-200 bg-red-50"
                  : "border-blue-200 bg-blue-50"
              }`}
            >
              <div className="flex items-start gap-3">
                {pendingLibraryCommand.plan.destructive ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />
                ) : (
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-bold ${
                      pendingLibraryCommand.plan.destructive
                        ? "text-red-950"
                        : "text-blue-950"
                    }`}
                  >
                    请确认文献库操作
                  </p>
                  <p
                    className={`mt-1 text-sm leading-6 ${
                      pendingLibraryCommand.plan.destructive
                        ? "text-red-800"
                        : "text-blue-800"
                    }`}
                  >
                    {pendingLibraryCommand.plan.summary}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    系统已根据当前文献库匹配到具体对象，确认后才会修改真实数据。
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void executePendingLibraryCommand()}
                      disabled={isExecutingLibraryCommand}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white disabled:opacity-50 ${
                        pendingLibraryCommand.plan.destructive
                          ? "bg-red-700 hover:bg-red-800"
                          : "bg-blue-700 hover:bg-blue-800"
                      }`}
                    >
                      {isExecutingLibraryCommand ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {isExecutingLibraryCommand ? "正在执行" : "确认执行"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingLibraryCommand(null)}
                      disabled={isExecutingLibraryCommand}
                      className="inline-flex items-center gap-2 border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {pendingProjectPayload && !pendingLibraryCommand && (
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

          {pendingTemporaryPayload && !pendingLibraryCommand && (
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
            onNewProject={openNewProjectDialog}
            onBindLocalFolder={handleBindLocalFolder}
            selectedFolders={selectedFolders}
            onRemoveFolder={(folderId) =>
              setSelectedFolderIds((current) =>
                current.filter((id) => id !== folderId),
              )
            }
            onFolderDrop={handleFolderDrop}
          />
          {usage.total > 0 && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap text-[10px] text-gray-500">
              本次会话约 {usage.total.toLocaleString()} tokens · 模型成本约 $
              {usage.costUsd.toFixed(4)}
              {usage.cachedInput > 0
                ? ` · 缓存 ${usage.cachedInput.toLocaleString()}`
                : ""}
              {usage.reasoning > 0
                ? ` · 推理 ${usage.reasoning.toLocaleString()}`
                : ""}
            </div>
          )}
        </main>
      </div>

      <ResearchToolPanel
        open={toolPanelOpen}
        folder={activeToolFolder}
        project={activeToolFolder ? null : activeProject}
        cloudFolders={
          activeProject
            ? folders.filter((folder) => activeProject.folderIds.includes(folder.id))
            : []
        }
        papers={toolPapers}
        selectedLocalFileIds={selectedLocalFileIds}
        isStreaming={isStreaming}
        activity={activity}
        busyPaperId={busyLibraryPaperId}
        isUploading={isUploadingToFolder}
        operationMessage={libraryOperationMessage}
        operationError={libraryOperationError}
        localPdfStatus={localPdfStatus}
        activeLocalPdfAction={activeLocalPdfAction}
        onOpenLocalPdf={(file) => void handleOpenLocalPdf(file)}
        onReadLocalPdf={(file) => void handleReadLocalPdf(file)}
        onToggleLocalFile={handleToggleLocalFile}
        onToggleLocalFolder={handleToggleLocalFolder}
        onClearLocalSelection={handleClearLocalFileSelection}
        onRunLocalFileTask={handleRunLocalFileTask}
        onOpenCloudFolder={handleOpenFolder}
        onRemovePaper={(paper) => void handleRemovePaperFromOpenFolder(paper)}
        onUploadFiles={(files) => void handleUploadFilesToOpenFolder(files)}
        onClose={() => setToolPanelOpen(false)}
      />

      {pendingProjectTranslation && (
        <ProjectTranslationDialog
          files={pendingProjectTranslation.files}
          initialOutputMode={pendingProjectTranslation.outputMode}
          onClose={() => setPendingProjectTranslation(null)}
        />
      )}

      {newProjectDialogOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4">
          <form
            className="w-full max-w-md border border-gray-200 bg-white p-5 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              createBlankProject();
            }}
          >
            <h2 className="text-lg font-bold text-gray-950">创建新项目</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">
              项目会保存对应的聊天、文献文件夹和后续任务，方便下次继续。
            </p>
            <label
              htmlFor="new-project-name"
              className="mt-4 block text-xs font-bold text-gray-700"
            >
              项目名称
            </label>
            <input
              id="new-project-name"
              autoFocus
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="例如：有机催化文献综述"
              maxLength={80}
              className="mt-2 h-11 w-full border border-gray-300 px-3 text-sm outline-none focus:border-blue-500"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewProjectDialogOpen(false)}
                className="h-10 border border-gray-300 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!newProjectName.trim()}
                className="h-10 bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800 disabled:bg-gray-200 disabled:text-gray-400"
              >
                创建并进入
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
