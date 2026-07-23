import type { ChatMessage } from "@/lib/ai/types";
import type { IntentPlan } from "@/lib/chat/intent-router";
import type { ToolPlan } from "@/lib/chat/tool-planner";
import { getToolLabel } from "@/lib/chat/tool-registry";

export type ExecutableProjectFile = {
  id: string;
  name: string;
  size: number;
  extension?: string;
  kind?: string;
  readable?: boolean;
};

export type ExecutableProjectFolder = {
  id: string;
  name: string;
  path?: string;
  fileCount: number;
  pdfCount: number;
  truncated?: boolean;
  files: ExecutableProjectFile[];
};

export type ExecutableProjectContext = {
  id?: string;
  name?: string;
  selectedLocalFileIds: string[];
  localFolders: ExecutableProjectFolder[];
};

export type ToolExecutionResult = {
  ran: boolean;
  statuses: string[];
  contextMessages: ChatMessage[];
  blockingMessage?: string;
};

const MAX_CONTEXT_FOLDERS = 12;
const MAX_CONTEXT_FILES_PER_FOLDER = 80;
const MAX_MANIFEST_FILES = 140;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sanitizeStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

export function sanitizeExecutableProjectContext(
  value: unknown,
): ExecutableProjectContext | null {
  const record = asObject(value);
  if (!record) return null;

  const rawFolders = Array.isArray(record.localFolders)
    ? record.localFolders
    : [];
  const localFolders = rawFolders
    .slice(0, MAX_CONTEXT_FOLDERS)
    .map((rawFolder) => {
      const folder = asObject(rawFolder);
      if (!folder) return null;
      const rawFiles = Array.isArray(folder.files) ? folder.files : [];
      const files = rawFiles
        .slice(0, MAX_CONTEXT_FILES_PER_FOLDER)
        .map((rawFile) => {
          const file = asObject(rawFile);
          if (!file) return null;
          const id = sanitizeString(file.id, 160);
          const name = sanitizeString(file.name, 300);
          if (!id || !name) return null;
          const nextFile: ExecutableProjectFile = {
            id,
            name,
            size: sanitizeNumber(file.size),
          };
          const extension = sanitizeString(file.extension, 24);
          const kind = sanitizeString(file.kind, 32);
          const readable = sanitizeBoolean(file.readable);
          if (extension) nextFile.extension = extension;
          if (kind) nextFile.kind = kind;
          if (typeof readable === "boolean") nextFile.readable = readable;
          return nextFile;
        })
        .filter((file): file is ExecutableProjectFile => Boolean(file));

      const id = sanitizeString(folder.id, 160);
      const name = sanitizeString(folder.name, 200);
      if (!id || !name) return null;
      const nextFolder: ExecutableProjectFolder = {
        id,
        name,
        fileCount: sanitizeNumber(folder.fileCount) || files.length,
        pdfCount: sanitizeNumber(folder.pdfCount),
        files,
      };
      const path = sanitizeString(folder.path, 500);
      const truncated = sanitizeBoolean(folder.truncated);
      if (path) nextFolder.path = path;
      if (typeof truncated === "boolean") nextFolder.truncated = truncated;
      return nextFolder;
    })
    .filter((folder): folder is ExecutableProjectFolder => Boolean(folder));

  const id = sanitizeString(record.id, 160);
  const name = sanitizeString(record.name, 160);
  if (!id && !name && localFolders.length === 0) return null;

  return {
    id,
    name,
    selectedLocalFileIds: sanitizeStringArray(record.selectedLocalFileIds, 120),
    localFolders,
  };
}

function projectFileScope(context: ExecutableProjectContext): {
  selected: ExecutableProjectFile[];
  all: ExecutableProjectFile[];
  selectedIds: Set<string>;
} {
  const selectedIds = new Set(context.selectedLocalFileIds);
  const all = context.localFolders.flatMap((folder) => folder.files);
  const selected = selectedIds.size
    ? all.filter((file) => selectedIds.has(file.id))
    : [];
  return { selected, all, selectedIds };
}

function buildProjectManifest(context: ExecutableProjectContext): string {
  const { selectedIds } = projectFileScope(context);
  const selectedOnly = selectedIds.size > 0;
  let emitted = 0;
  const lines: string[] = [
    "【当前项目资料清单】",
    `项目：${context.name || "未命名项目"}`,
    selectedOnly
      ? `本次用户已选中文件数：${selectedIds.size}。除非用户明确要求全部项目资料，否则优先只分析这些选中文件。`
      : "本次用户未勾选具体文件。项目任务默认读取当前项目绑定的全部资料，不要读取其他项目或其他文件夹。",
    "注意：服务器不能直接访问用户电脑。下方清单只代表用户授权范围；真正全文读取由前端本机连接器完成。若没有全文证据包，不要假装已读全文。",
    "",
  ];

  for (const folder of context.localFolders) {
    lines.push(
      `文件夹：${folder.name}（文件 ${folder.fileCount} 个，PDF ${folder.pdfCount} 个${folder.truncated ? "，列表可能已截断" : ""}）`,
    );
    if (folder.path) lines.push(`授权路径：${folder.path}`);

    for (const file of folder.files) {
      if (emitted >= MAX_MANIFEST_FILES) break;
      emitted += 1;
      const selectedMark = selectedIds.has(file.id) ? "已选中" : "未选中";
      const readable =
        file.readable === false ? "不可全文读取" : "可尝试全文读取";
      const ext = file.extension || file.name.split(".").pop() || "";
      lines.push(
        `- ${file.name} | ${file.kind || "file"} ${ext ? `.${ext.replace(/^\./, "")}` : ""} | ${selectedMark} | ${readable}`,
      );
    }
    if (emitted >= MAX_MANIFEST_FILES) {
      lines.push(
        `其余文件未展开：为控制上下文，最多只展示 ${MAX_MANIFEST_FILES} 个文件名。`,
      );
      break;
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function executeToolPlan(input: {
  intentPlan: IntentPlan;
  toolPlan: ToolPlan;
  projectContext: ExecutableProjectContext | null;
  selectedFolderIds: string[];
  contextMode: "auto" | "project" | "temporary";
  projectName: string;
}): Promise<ToolExecutionResult> {
  const statuses: string[] = [];
  const contextMessages: ChatMessage[] = [];
  const tools = new Set(input.toolPlan.steps.flatMap((step) => step.tools));
  const needsProjectContext =
    input.intentPlan.inputScope === "current_project" ||
    input.contextMode === "project" ||
    tools.has("local_connector") ||
    tools.has("project_workspace");

  statuses.push(
    `工具执行层：已规划 ${input.toolPlan.steps.length} 步，涉及 ${Array.from(
      tools,
    )
      .map(getToolLabel)
      .join("、")}。`,
  );

  if (input.contextMode === "temporary") {
    statuses.push("执行范围：临时问题，不读取当前项目资料。");
    return { ran: true, statuses, contextMessages };
  }

  if (input.projectContext && needsProjectContext) {
    const fileScope = projectFileScope(input.projectContext);
    const folderCount = input.projectContext.localFolders.length;
    const fileCount = fileScope.all.length;
    const selectedCount = fileScope.selected.length;

    statuses.push(
      selectedCount > 0
        ? `项目资料：已确认 ${folderCount} 个本地文件夹、${fileCount} 个文件；本次优先分析已选中的 ${selectedCount} 个文件。`
        : `项目资料：已确认 ${folderCount} 个本地文件夹、${fileCount} 个文件；未选择具体文件时默认使用当前项目资料。`,
    );

    contextMessages.push({
      role: "system",
      content: buildProjectManifest(input.projectContext),
    });
  } else if (needsProjectContext && input.projectName) {
    statuses.push(
      "项目资料：已选择项目，但前端没有同步本地资料清单；本次只能使用已上传或已写入对话的内容。",
    );
  } else if (needsProjectContext) {
    return {
      ran: true,
      statuses,
      contextMessages,
      blockingMessage:
        "这个任务需要先选择项目或绑定资料范围。请先选择项目、勾选文件，或把文件拖入聊天框后再执行。",
    };
  }

  if (tools.has("local_connector") && !input.projectContext) {
    statuses.push(
      "本机连接器：服务器不能直接读取本机文件，需要网页前端通过本机连接器读取后再交给 AI。",
    );
  }

  if (input.selectedFolderIds.length > 0) {
    statuses.push(
      `文献库范围：已限制为用户选择的 ${input.selectedFolderIds.length} 个文献文件夹。`,
    );
  }

  return { ran: true, statuses, contextMessages };
}
