import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";
import type { ExecutableProjectContext } from "@/lib/chat/tool-executor";

export type ContextBundle = {
  currentUserRequest: string;
  isFollowUp: boolean;
  followUpTarget:
    | "none"
    | "previous_assistant_output"
    | "current_project"
    | "selected_files"
    | "selected_folders";
  taskTypeHint:
    | "unknown"
    | "conversation"
    | "create_artifact"
    | "revise_existing_output"
    | "critique_existing_output"
    | "file_analysis";
  contentSource:
    | "current_message"
    | "previous_assistant_output"
    | "current_project"
    | "selected_files"
    | "selected_folders";
  projectName: string;
  selectedFolderCount: number;
  localFolderCount: number;
  selectedLocalFileCount: number;
  memorySummary: string;
  recentConversationSummary: string;
  activeFilesSummary: string;
  lastAssistantConclusion: string;
  usablePreviousOutput: string;
  usablePreviousOutputSummary: string;
  conflicts: string[];
  missingRequiredInfo: string[];
};

const MAX_PREVIOUS_OUTPUT_CHARS = 6000;
const MAX_PREVIOUS_SUMMARY_CHARS = 900;
const MAX_MEMORY_SUMMARY_CHARS = 1200;
const MAX_RECENT_CONVERSATION_CHARS = 1200;
const MAX_LAST_ASSISTANT_CHARS = 700;
const MAX_ACTIVE_FILES_CHARS = 900;

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

function stripGeneratedFileFooter(content: string): string {
  return content
    .replace(/\[\[RESEARCHGPT_PLAN:[\s\S]*?\]\]\s*/g, "")
    .replace(
      /\n-{3,}\n\s*(Generated downloadable files|Downloadable files)[\s\S]*$/iu,
      "",
    )
    .trim();
}

function lastUserText(messages: ChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return message ? getTextFromMessageContent(message.content).trim() : "";
}

function previousAssistantTextBeforeLastUser(messages: ChatMessage[]): string {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const searchEnd = lastUserIndex >= 0 ? lastUserIndex : messages.length;

  for (let index = searchEnd - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = stripGeneratedFileFooter(
      getTextFromMessageContent(message.content),
    );
    if (text.length >= 80) return text;
  }

  return "";
}

function recentConversationSummary(messages: ChatMessage[]): string {
  const items = messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      const text = compact(
        stripGeneratedFileFooter(getTextFromMessageContent(message.content)),
        220,
      );
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean);

  return compact(items.join("\n"), MAX_RECENT_CONVERSATION_CHARS);
}

function activeFilesSummary(input: {
  projectContext: ExecutableProjectContext | null;
  selectedFolderIds: string[];
  projectName: string;
}): string {
  const parts: string[] = [];
  if (input.projectName) parts.push(`Project: ${input.projectName}`);
  if (input.selectedFolderIds.length > 0) {
    parts.push(`Selected cloud folders: ${input.selectedFolderIds.length}`);
  }

  const context = input.projectContext;
  if (!context) return compact(parts.join("; "), MAX_ACTIVE_FILES_CHARS);

  const selectedIds = new Set(context.selectedLocalFileIds);
  const folders = context.localFolders.slice(0, 6).map((folder) => {
    const selectedInFolder = folder.files.filter((file) =>
      selectedIds.has(file.id),
    );
    const visibleFiles = (selectedInFolder.length ? selectedInFolder : folder.files)
      .slice(0, 5)
      .map((file) => {
        const ext = file.extension ? `.${file.extension}` : "";
        const readability =
          typeof file.readable === "boolean"
            ? file.readable
              ? "readable"
              : "not readable"
            : "readability unknown";
        return `${file.name}${ext ? ` (${ext}, ${readability})` : ` (${readability})`}`;
      });

    const scopeLabel = selectedInFolder.length
      ? `${selectedInFolder.length} selected`
      : `${folder.fileCount} files`;
    return `${folder.name}: ${scopeLabel}${
      visibleFiles.length ? `; examples: ${visibleFiles.join(" | ")}` : ""
    }`;
  });

  parts.push(`Bound local folders: ${context.localFolders.length}`);
  if (context.selectedLocalFileIds.length > 0) {
    parts.push(`Selected local files: ${context.selectedLocalFileIds.length}`);
  }
  if (folders.length > 0) parts.push(folders.join("\n"));

  return compact(parts.join("\n"), MAX_ACTIVE_FILES_CHARS);
}

function buildMemorySummary(input: {
  memory?: string;
  projectName: string;
  recentSummary: string;
  activeSummary: string;
}): string {
  const parts = [
    input.memory ? `Saved user preferences: ${compact(input.memory, 600)}` : "",
    input.projectName ? `Active project: ${input.projectName}` : "",
    input.activeSummary ? `Active material scope: ${input.activeSummary}` : "",
    input.recentSummary ? `Recent conversation: ${input.recentSummary}` : "",
  ].filter(Boolean);

  return compact(parts.join("\n"), MAX_MEMORY_SUMMARY_CHARS);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function isArtifactFollowUp(query: string): boolean {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length > 180) return false;
  return hasAny(normalized, [
    /(生成|输出|导出|下载|做成|转成|保存|给我).{0,24}(word|docx|excel|xlsx|pdf|ppt|pptx|文件|文档|表格|报告)/i,
    /\b(word|docx|excel|xlsx|pdf|ppt|pptx)\b/i,
  ]);
}

function isRevisionFollowUp(query: string): boolean {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (normalized.length > 240) return false;
  return hasAny(normalized, [
    /(改成|修改|优化|精简|扩写|润色|重写|换成|继续|接着|按这个|按照这个|上一版|刚才)/,
    /(make it|revise|rewrite|continue|polish|shorten|expand)/i,
  ]);
}

function isCritiqueFollowUp(query: string): boolean {
  return hasAny(query, [
    /(为什么|为啥|哪里|区别|差别|差距|问题|不一样|没区别|没有区别|怎么回事|什么情况).{0,48}(图|图片|结果|回答|输出|文件|文档)/,
    /(图|图片|结果|回答|输出|文件|文档).{0,48}(为什么|为啥|哪里|区别|差别|差距|问题|不一样|没区别|没有区别|怎么回事|什么情况)/,
  ]);
}

function isFileAnalysisRequest(query: string): boolean {
  return hasAny(query, [
    /(分析|总结|解读|读取|精读|提取).{0,36}(文件|文献|项目|资料|folder|paper|pdf|docx|pptx|xlsx)/i,
    /(这些|这个|当前|项目).{0,16}(文件|文献|资料).{0,16}(分析|总结|解读|读取|精读)/,
  ]);
}

function selectedLocalFileCount(
  projectContext: ExecutableProjectContext | null,
): number {
  if (!projectContext) return 0;
  return projectContext.selectedLocalFileIds.length;
}

export function buildContextBundle(input: {
  messages: ChatMessage[];
  selectedFolderIds: string[];
  contextMode: "auto" | "project" | "temporary";
  projectName: string;
  projectContext: ExecutableProjectContext | null;
  memory?: string;
}): ContextBundle {
  const currentUserRequest = lastUserText(input.messages);
  const previousAssistantOutput = previousAssistantTextBeforeLastUser(
    input.messages,
  );
  const recentSummary = recentConversationSummary(input.messages);
  const lastAssistantConclusion = compact(
    previousAssistantOutput,
    MAX_LAST_ASSISTANT_CHARS,
  );
  const activeSummary = activeFilesSummary({
    projectContext: input.projectContext,
    selectedFolderIds: input.selectedFolderIds,
    projectName: input.projectName,
  });
  const memorySummary = buildMemorySummary({
    memory: input.memory,
    projectName: input.projectName,
    recentSummary,
    activeSummary,
  });
  const localFolderCount = input.projectContext?.localFolders.length ?? 0;
  const localSelectedCount = selectedLocalFileCount(input.projectContext);
  const hasProjectContext =
    Boolean(input.projectName) ||
    localFolderCount > 0 ||
    input.contextMode === "project";
  const hasSelectedScope =
    input.selectedFolderIds.length > 0 || localSelectedCount > 0;

  let taskTypeHint: ContextBundle["taskTypeHint"] = "unknown";
  if (isCritiqueFollowUp(currentUserRequest)) {
    taskTypeHint = "critique_existing_output";
  } else if (isArtifactFollowUp(currentUserRequest)) {
    taskTypeHint = "create_artifact";
  } else if (isRevisionFollowUp(currentUserRequest)) {
    taskTypeHint = "revise_existing_output";
  } else if (isFileAnalysisRequest(currentUserRequest)) {
    taskTypeHint = "file_analysis";
  }

  const canUsePreviousOutput =
    previousAssistantOutput.length >= 80 &&
    [
      "create_artifact",
      "revise_existing_output",
      "critique_existing_output",
    ].includes(taskTypeHint);

  let followUpTarget: ContextBundle["followUpTarget"] = "none";
  let contentSource: ContextBundle["contentSource"] = "current_message";

  if (canUsePreviousOutput) {
    followUpTarget = "previous_assistant_output";
    contentSource = "previous_assistant_output";
  } else if (localSelectedCount > 0) {
    followUpTarget = "selected_files";
    contentSource = "selected_files";
  } else if (input.selectedFolderIds.length > 0) {
    followUpTarget = "selected_folders";
    contentSource = "selected_folders";
  } else if (hasProjectContext) {
    followUpTarget = "current_project";
    contentSource = "current_project";
  }

  const missingRequiredInfo: string[] = [];
  if (
    taskTypeHint === "create_artifact" &&
    contentSource === "current_message" &&
    currentUserRequest.length < 80
  ) {
    missingRequiredInfo.push("No reusable content was found for the requested file.");
  }
  if (taskTypeHint === "file_analysis" && !hasProjectContext && !hasSelectedScope) {
    missingRequiredInfo.push("No project, selected files, or selected folders were found.");
  }

  const conflicts: string[] = [];
  if (input.contextMode === "temporary" && hasSelectedScope) {
    conflicts.push(
      "Temporary mode is active while a selected file scope exists; temporary mode wins unless the user asks to use project files.",
    );
  }

  return {
    currentUserRequest,
    isFollowUp: followUpTarget !== "none",
    followUpTarget,
    taskTypeHint,
    contentSource,
    projectName: input.projectName,
    selectedFolderCount: input.selectedFolderIds.length,
    localFolderCount,
    selectedLocalFileCount: localSelectedCount,
    memorySummary,
    recentConversationSummary: recentSummary,
    activeFilesSummary: activeSummary,
    lastAssistantConclusion,
    usablePreviousOutput: previousAssistantOutput.slice(
      0,
      MAX_PREVIOUS_OUTPUT_CHARS,
    ),
    usablePreviousOutputSummary: compact(
      previousAssistantOutput,
      MAX_PREVIOUS_SUMMARY_CHARS,
    ),
    conflicts,
    missingRequiredInfo,
  };
}

export function contextBundleToSystemMessage(bundle: ContextBundle): ChatMessage {
  const lines = [
    "[ResearchGPT Context Bundle]",
    `Current user request: ${bundle.currentUserRequest || "(empty)"}`,
    `Is follow-up: ${bundle.isFollowUp ? "yes" : "no"}`,
    `Follow-up target: ${bundle.followUpTarget}`,
    `Task type hint: ${bundle.taskTypeHint}`,
    `Content source: ${bundle.contentSource}`,
    `Current project: ${bundle.projectName || "(none)"}`,
    `Selected cloud folder count: ${bundle.selectedFolderCount}`,
    `Bound local folder count: ${bundle.localFolderCount}`,
    `Selected local file count: ${bundle.selectedLocalFileCount}`,
    bundle.memorySummary
      ? `Cached context summary: ${bundle.memorySummary}`
      : "Cached context summary: none",
    bundle.activeFilesSummary
      ? `Active file scope summary: ${bundle.activeFilesSummary}`
      : "Active file scope summary: none",
    bundle.lastAssistantConclusion
      ? `Last assistant conclusion: ${bundle.lastAssistantConclusion}`
      : "Last assistant conclusion: none",
    bundle.usablePreviousOutputSummary
      ? `Reusable previous output summary: ${bundle.usablePreviousOutputSummary}`
      : "Reusable previous output summary: none",
    bundle.conflicts.length
      ? `Conflicts: ${bundle.conflicts.join("; ")}`
      : "Conflicts: none",
    bundle.missingRequiredInfo.length
      ? `Missing required info: ${bundle.missingRequiredInfo.join("; ")}`
      : "Missing required info: none",
    "",
    "Rules:",
    "1. If content source is previous_assistant_output and the user asks for Word/Excel/PDF/PPT, use the reusable previous output as the source content. Do not ask what content to generate.",
    "2. If the user critiques a previous image, file, or answer, explain or suggest a revision. Do not trigger a generation tool unless the user explicitly asks to regenerate.",
    "3. If selected files exist, read only selected files first. Otherwise use the current project's bound material.",
    "4. The current user request always has priority over old context.",
    "5. Prefer the cached context summary for continuity. Only use the full previous output when the user explicitly asks to reuse, revise, export, or critique that previous output.",
  ];

  if (
    bundle.usablePreviousOutput &&
    bundle.contentSource === "previous_assistant_output"
  ) {
    lines.push("", "[Reusable Previous Output Full Text]", bundle.usablePreviousOutput);
  }

  return {
    role: "system",
    content: lines.join("\n"),
  };
}
