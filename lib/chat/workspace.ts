"use client";

export type WorkspaceContextMode = "auto" | "project" | "temporary";

export type ResearchProject = {
  id: string;
  name: string;
  conversationId: string | null;
  folderIds: string[];
  lastTask: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceStorage = {
  projects: ResearchProject[];
  activeProjectId: string | null;
};

const STORAGE_KEY = "researchgpt-research-workspace-v1";
export const FOLDER_DRAG_TYPE = "application/x-researchgpt-folder";

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
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    ) as Record<string, unknown>;
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter(isProject)
      : [];
    const activeProjectId =
      typeof parsed.activeProjectId === "string" &&
      projects.some((project) => project.id === parsed.activeProjectId)
        ? parsed.activeProjectId
        : null;
    return {
      projects: [...projects].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      ),
      activeProjectId,
    };
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
