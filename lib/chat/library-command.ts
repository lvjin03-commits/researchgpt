import type {
  LiteratureFolder,
  LiteraturePaper,
} from "@/lib/literature/types";

export type LibraryCommandPlan =
  | {
      kind: "create_folder";
      folderName: string;
      summary: string;
      destructive: false;
    }
  | {
      kind: "rename_folder";
      folderId: string;
      folderName: string;
      nextName: string;
      summary: string;
      destructive: false;
    }
  | {
      kind: "delete_folder";
      folderId: string;
      folderName: string;
      summary: string;
      destructive: true;
    }
  | {
      kind: "delete_paper";
      paperId: string;
      paperTitle: string;
      summary: string;
      destructive: true;
    }
  | {
      kind: "move_paper" | "add_paper_to_folder" | "remove_paper_from_folder";
      paperId: string;
      paperTitle: string;
      folderId: string;
      folderName: string;
      currentFolderIds: string[];
      summary: string;
      destructive: boolean;
    };

export type LibraryCommandResult =
  | { type: "none" }
  | { type: "error"; message: string }
  | { type: "plan"; plan: LibraryCommandPlan };

function cleanName(value: string): string {
  return value
    .trim()
    .replace(/^[“”"'《》]+|[“”"'《》。！!]+$/g, "")
    .trim();
}

function cleanFolderQuery(value: string): string {
  return cleanName(value)
    .replace(/^(?:文献)?文件夹\s*/i, "")
    .replace(/\s*(?:文献)?文件夹(?:中|里)?$/i, "")
    .replace(/\s*(?:中|里)$/i, "")
    .trim();
}

function normalized(value: string): string {
  return cleanName(value)
    .replace(/\s+/g, "")
    .toLocaleLowerCase("zh-CN");
}

function isArtifactOrVisualRequest(value: string): boolean {
  return /(?:生成|制作|创建|导出|画|绘制|整理成|总结成|转成|做成).{0,24}(?:图片|图像|图表|图解|可视化|流程图|时间轴|鱼骨图|技术路线图|框架图|结构图|思维导图|示意图|PPT|幻灯片|Word|文档|PDF|Excel|表格|报告|png|svg)|(?:image|diagram|visuali[sz]ation|chart|figure|graph|flowchart|timeline|fishbone|ishikawa|ppt|slides|word|docx|pdf|excel|xlsx|artifact)/i.test(
    value,
  );
}

function resolveNamedItem<T>(
  query: string,
  items: T[],
  getName: (item: T) => string,
  itemLabel: string,
): { item?: T; error?: string } {
  const needle = normalized(query);
  if (!needle) return { error: `请说明${itemLabel}名称。` };

  const exact = items.filter((item) => normalized(getName(item)) === needle);
  if (exact.length === 1) return { item: exact[0] };

  const partial = items.filter((item) => {
    const name = normalized(getName(item));
    return name.includes(needle) || needle.includes(name);
  });
  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) {
    return {
      error: `找到多个匹配的${itemLabel}：${partial
        .slice(0, 5)
        .map(getName)
        .join("、")}。请使用更完整的名称。`,
    };
  }
  return { error: `没有找到${itemLabel}“${cleanName(query)}”。` };
}

function planPaperFolderAction(
  kind: "move_paper" | "add_paper_to_folder" | "remove_paper_from_folder",
  paperQuery: string,
  folderQuery: string,
  folders: LiteratureFolder[],
  papers: LiteraturePaper[],
): LibraryCommandResult {
  const paperMatch = resolveNamedItem(
    paperQuery,
    papers,
    (paper) => paper.title,
    "文献",
  );
  if (!paperMatch.item) {
    return { type: "error", message: paperMatch.error ?? "未找到文献。" };
  }
  const folderMatch = resolveNamedItem(
    cleanFolderQuery(folderQuery),
    folders,
    (folder) => folder.name,
    "文件夹",
  );
  if (!folderMatch.item) {
    return { type: "error", message: folderMatch.error ?? "未找到文件夹。" };
  }

  const paper = paperMatch.item;
  const folder = folderMatch.item;
  const currentFolderIds = paper.folderIds ?? [];
  if (
    kind === "add_paper_to_folder" &&
    currentFolderIds.includes(folder.id)
  ) {
    return {
      type: "error",
      message: `文献“${paper.title}”已经在文件夹“${folder.name}”中。`,
    };
  }
  if (
    kind === "remove_paper_from_folder" &&
    !currentFolderIds.includes(folder.id)
  ) {
    return {
      type: "error",
      message: `文献“${paper.title}”不在文件夹“${folder.name}”中。`,
    };
  }
  if (
    kind === "move_paper" &&
    currentFolderIds.length === 1 &&
    currentFolderIds[0] === folder.id
  ) {
    return {
      type: "error",
      message: `文献“${paper.title}”已经只归类在文件夹“${folder.name}”中。`,
    };
  }
  const verb =
    kind === "move_paper"
      ? "移动到"
      : kind === "add_paper_to_folder"
        ? "加入"
        : "从中移除";

  return {
    type: "plan",
    plan: {
      kind,
      paperId: paper.id,
      paperTitle: paper.title,
      folderId: folder.id,
      folderName: folder.name,
      currentFolderIds,
      summary: `${verb}文件夹“${folder.name}”：${paper.title}`,
      destructive: kind !== "add_paper_to_folder",
    },
  };
}

export function planLibraryCommand(
  command: string,
  folders: LiteratureFolder[],
  papers: LiteraturePaper[],
): LibraryCommandResult {
  const text = command.trim();
  if (!text) return { type: "none" };
  if (isArtifactOrVisualRequest(text)) return { type: "none" };

  let match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:新建|创建)(?:一个)?(?:文献)?文件夹(?:叫|名为|为|：|:)?\s*(.+)$/i,
  );
  if (match) {
    const folderName = cleanName(match[1]);
    if (!folderName) return { type: "error", message: "请说明新文件夹名称。" };
    if (folders.some((folder) => normalized(folder.name) === normalized(folderName))) {
      return { type: "error", message: `文件夹“${folderName}”已经存在。` };
    }
    return {
      type: "plan",
      plan: {
        kind: "create_folder",
        folderName,
        summary: `新建文献文件夹“${folderName}”`,
        destructive: false,
      },
    };
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:新建|创建)(?:一个)?(?:叫|名为|为)?\s*(.+?)\s*的(?:文献)?文件夹$/i,
  );
  if (match) {
    const folderName = cleanName(match[1]);
    if (!folderName) return { type: "error", message: "请说明新文件夹名称。" };
    if (folders.some((folder) => normalized(folder.name) === normalized(folderName))) {
      return { type: "error", message: `文件夹“${folderName}”已经存在。` };
    }
    return {
      type: "plan",
      plan: {
        kind: "create_folder",
        folderName,
        summary: `新建文献文件夹“${folderName}”`,
        destructive: false,
      },
    };
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:把)?(?:文献)?文件夹\s*(.+?)\s*(?:重命名为|改名为|改成)\s*(.+)$/i,
  );
  if (match) {
    const folderMatch = resolveNamedItem(
      match[1],
      folders,
      (folder) => folder.name,
      "文件夹",
    );
    if (!folderMatch.item) {
      return { type: "error", message: folderMatch.error ?? "未找到文件夹。" };
    }
    const nextName = cleanName(match[2]);
    if (!nextName) return { type: "error", message: "请说明新的文件夹名称。" };
    return {
      type: "plan",
      plan: {
        kind: "rename_folder",
        folderId: folderMatch.item.id,
        folderName: folderMatch.item.name,
        nextName,
        summary: `将文件夹“${folderMatch.item.name}”重命名为“${nextName}”`,
        destructive: false,
      },
    };
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:删除|移除)(?:这个)?(?:文献)?文件夹\s*(.+)$/i,
  );
  if (match) {
    const folderMatch = resolveNamedItem(
      match[1],
      folders,
      (folder) => folder.name,
      "文件夹",
    );
    if (!folderMatch.item) {
      return { type: "error", message: folderMatch.error ?? "未找到文件夹。" };
    }
    return {
      type: "plan",
      plan: {
        kind: "delete_folder",
        folderId: folderMatch.item.id,
        folderName: folderMatch.item.name,
        summary: `删除文献文件夹“${folderMatch.item.name}”（只删除文件夹分类，不删除其中 PDF）`,
        destructive: true,
      },
    };
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:删除|移除)\s*(.+?)\s*(?:文献)?文件夹$/i,
  );
  if (match) {
    const folderMatch = resolveNamedItem(
      cleanFolderQuery(match[1]),
      folders,
      (folder) => folder.name,
      "文件夹",
    );
    if (!folderMatch.item) {
      return { type: "error", message: folderMatch.error ?? "未找到文件夹。" };
    }
    return {
      type: "plan",
      plan: {
        kind: "delete_folder",
        folderId: folderMatch.item.id,
        folderName: folderMatch.item.name,
        summary: `删除文献文件夹“${folderMatch.item.name}”（只删除文件夹分类，不删除其中 PDF）`,
        destructive: true,
      },
    };
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:把)?(?:文献|论文)?\s*(.+?)\s*(?:移动到|移到)\s*(.+)$/i,
  );
  if (match) {
    return planPaperFolderAction(
      "move_paper",
      match[1],
      match[2],
      folders,
      papers,
    );
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:把)?(?:文献|论文)?\s*(.+?)\s*(?:放入|加入|添加到)\s*(.+)$/i,
  );
  if (match) {
    return planPaperFolderAction(
      "add_paper_to_folder",
      match[1],
      match[2],
      folders,
      papers,
    );
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*从\s*(.+?)\s*(?:中|里)?(?:移除|删除)\s*(?:文献|论文)?\s*(.+)$/i,
  );
  if (match) {
    return planPaperFolderAction(
      "remove_paper_from_folder",
      match[2],
      match[1],
      folders,
      papers,
    );
  }

  match = text.match(
    /^(?:请|帮我|请帮我)?\s*(?:从文献库(?:中)?删除|删除文献|删除论文)\s*(.+)$/i,
  );
  if (match) {
    const paperMatch = resolveNamedItem(
      match[1],
      papers,
      (paper) => paper.title,
      "文献",
    );
    if (!paperMatch.item) {
      return { type: "error", message: paperMatch.error ?? "未找到文献。" };
    }
    return {
      type: "plan",
      plan: {
        kind: "delete_paper",
        paperId: paperMatch.item.id,
        paperTitle: paperMatch.item.title,
        summary: `从文献库永久删除：${paperMatch.item.title}`,
        destructive: true,
      },
    };
  }

  const mentionsLibraryMutation =
    /(新建|创建|删除|移除|移动|重命名|改名|放入|加入|添加).*(文件夹|文献|论文)|(?:文件夹|文献|论文).*(新建|创建|删除|移除|移动|重命名|改名|放入|加入|添加)/i.test(
      text,
    );
  return mentionsLibraryMutation
    ? {
        type: "error",
        message:
          "我识别到这是文献库操作，但没有可靠识别目标。请写明完整的文件夹或文献名称。",
      }
    : { type: "none" };
}
