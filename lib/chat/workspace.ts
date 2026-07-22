"use client";

export type WorkspaceContextMode = "auto" | "project" | "temporary";

export type LocalWorkspaceFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  extension?: string;
  kind?: "pdf" | "word" | "excel" | "ppt" | "image" | "text" | "other";
  readable?: boolean;
};

export type LocalWorkspaceFolder = {
  id: string;
  name: string;
  path: string;
  boundAt: string;
  pdfCount: number;
  fileCount?: number;
  truncated?: boolean;
  files: LocalWorkspaceFile[];
};

export type ResearchProject = {
  id: string;
  name: string;
  conversationId: string | null;
  folderIds: string[];
  localFolders: LocalWorkspaceFolder[];
  lastTask: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceStorage = {
  projects: ResearchProject[];
  activeProjectId: string | null;
};

const STORAGE_KEY = "researchgpt-research-workspace-v1";
export const FOLDER_DRAG_TYPE = "application/x-researchgpt-folder";
export const PAPER_DRAG_TYPE = "application/x-researchgpt-paper";

export function normalizeWorkspaceStorage(value: unknown): WorkspaceStorage {
  const record =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const projects = Array.isArray(record.projects)
    ? record.projects.filter(isProject).map((project) => ({
        ...project,
        localFolders: project.localFolders ?? [],
      }))
    : [];
  const activeProjectId =
    typeof record.activeProjectId === "string" &&
    projects.some((project) => project.id === record.activeProjectId)
      ? record.activeProjectId
      : null;

  return {
    projects: [...projects].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    ),
    activeProjectId,
  };
}

function isLocalFile(value: unknown): value is LocalWorkspaceFile {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.path === "string" &&
    typeof record.size === "number" &&
    typeof record.modifiedAt === "string" &&
    (typeof record.extension === "undefined" ||
      typeof record.extension === "string") &&
    (typeof record.kind === "undefined" ||
      record.kind === "pdf" ||
      record.kind === "word" ||
      record.kind === "excel" ||
      record.kind === "ppt" ||
      record.kind === "image" ||
      record.kind === "text" ||
      record.kind === "other") &&
    (typeof record.readable === "undefined" ||
      typeof record.readable === "boolean")
  );
}

function isLocalFolder(value: unknown): value is LocalWorkspaceFolder {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.path === "string" &&
    typeof record.boundAt === "string" &&
    typeof record.pdfCount === "number" &&
    (typeof record.fileCount === "undefined" ||
      typeof record.fileCount === "number") &&
    (typeof record.truncated === "undefined" ||
      typeof record.truncated === "boolean") &&
    Array.isArray(record.files) &&
    record.files.every(isLocalFile)
  );
}

function isProject(value: unknown): value is ResearchProject {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    (typeof record.conversationId === "string" ||
      record.conversationId === null) &&
    Array.isArray(record.folderIds) &&
    record.folderIds.every((item) => typeof item === "string") &&
    (typeof record.localFolders === "undefined" ||
      (Array.isArray(record.localFolders) &&
        record.localFolders.every(isLocalFolder))) &&
    typeof record.lastTask === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string"
  );
}

export function loadWorkspace(): WorkspaceStorage {
  if (typeof window === "undefined") {
    return { projects: [], activeProjectId: null };
  }

  try {
    return normalizeWorkspaceStorage(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"),
    );
  } catch {
    return { projects: [], activeProjectId: null };
  }
}

export function saveWorkspace(storage: WorkspaceStorage): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
}

export function createResearchProject(
  name: string,
  folderIds: string[],
  lastTask: string,
): ResearchProject {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim() || "未命名科研项目",
    conversationId: null,
    folderIds: [...new Set(folderIds)],
    localFolders: [],
    lastTask: lastTask.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

export function shouldSuggestProject(
  message: string,
  selectedFolderCount: number,
): boolean {
  if (selectedFolderCount === 0) return false;
  return /(分析|比较|矩阵|大纲|汇报|PPT|综述|追踪|长期|研究|实验|证据|analy|compare|matrix|outline|presentation|review|track)/i.test(
    message,
  );
}

function topicTokens(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(
      /(请|帮我|一下|这个|那个|进行|一个|如何|怎么|什么|please|help|with|the|and|for|this|that)/gi,
      " ",
    );
  const tokens = new Set(
    normalized
      .split(/[^\p{L}\p{N}]+/u)
      .map((item) => item.trim())
      .filter((item) => item.length >= 3),
  );
  const chinese = normalized.replace(/[^\p{Script=Han}]/gu, "");
  for (let index = 0; index < chinese.length - 1; index += 1) {
    tokens.add(chinese.slice(index, index + 2));
  }
  return tokens;
}

export function shouldSuggestTemporaryQuestion(
  message: string,
  project: ResearchProject,
): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < 4) return false;
  if (
    /(本项目|当前项目|这些|上述|前面|文件夹|文献|论文|数据|实验|继续|基于|this project|these papers|continue|based on)/i.test(
      trimmed,
    )
  ) {
    return false;
  }

  const projectTokens = topicTokens(`${project.name} ${project.lastTask}`);
  const messageTokens = topicTokens(trimmed);
  if (projectTokens.size === 0 || messageTokens.size === 0) return false;

  for (const token of messageTokens) {
    if (projectTokens.has(token)) return false;
  }

  return (
    trimmed.length <= 120 ||
    /[?？]|是什么|为什么|如何|怎么|哪里|谁|what|why|how|where|who/i.test(
      trimmed,
    )
  );
}
