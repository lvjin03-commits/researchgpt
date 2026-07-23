import type { IntentKind, ToolName } from "@/lib/chat/intent-router";

export type ToolCategory =
  | "file_reader"
  | "file_generator"
  | "local_connector"
  | "quality_checker"
  | "knowledge"
  | "model";

export type ToolReadiness = "ready" | "partial" | "planned";

export type ToolDefinition = {
  name: ToolName;
  label: string;
  category: ToolCategory;
  readiness: ToolReadiness;
  purpose: string;
  inputs: string[];
  outputs: string[];
  checks: string[];
  limitations: string[];
};

export const CHAT_TOOL_NAMES = [
  "chat_model",
  "web_search",
  "gpt_image",
  "svg_visual_renderer",
  "document_pipeline",
  "translation_pipeline",
  "literature_pipeline",
  "presentation_pipeline",
  "spreadsheet_pipeline",
  "literature_library",
  "project_workspace",
  "local_connector",
  "quality_checker",
] as const satisfies readonly ToolName[];

export const TOOL_REGISTRY: Record<ToolName, ToolDefinition> = {
  chat_model: {
    name: "chat_model",
    label: "语言模型",
    category: "model",
    readiness: "ready",
    purpose: "理解用户意图、规划任务、分析材料并组织最终回答。",
    inputs: ["用户问题", "项目上下文", "工具结果"],
    outputs: ["结构化计划", "自然语言回答", "文件生成内容草案"],
    checks: ["是否回答用户真实问题", "是否误调用工具", "是否混入无关项目资料"],
    limitations: ["不能直接读取用户电脑文件", "不能替代真实文件解析器"],
  },
  web_search: {
    name: "web_search",
    label: "联网搜索",
    category: "knowledge",
    readiness: "partial",
    purpose: "获取最新网页、论文、新闻、标准和官方资料。",
    inputs: ["检索词", "来源范围", "时间范围"],
    outputs: ["来源链接", "摘要", "可引用证据"],
    checks: ["来源是否可追溯", "时间是否最新", "是否优先使用权威来源"],
    limitations: ["不同数据库覆盖不完整", "不能保证 Google Scholar 级别的全量结果"],
  },
  gpt_image: {
    name: "gpt_image",
    label: "GPT Image",
    category: "file_generator",
    readiness: "partial",
    purpose: "生成科研插画、说明海报、概念图和高质量位图。",
    inputs: ["视觉 brief", "风格", "尺寸", "禁止项"],
    outputs: ["PNG 图片"],
    checks: ["文字是否可读", "主题是否正确", "是否裁切", "是否像科研图而不是装饰图"],
    limitations: ["图片费用单独计算", "精确小字和复杂公式不适合完全交给图片模型"],
  },
  svg_visual_renderer: {
    name: "svg_visual_renderer",
    label: "结构化图表",
    category: "file_generator",
    readiness: "ready",
    purpose: "生成流程图、鱼骨图、时间轴、框架图、对比图等可编辑图形。",
    inputs: ["结构化图表 JSON", "标题", "节点", "证据说明"],
    outputs: ["SVG", "PNG"],
    checks: ["节点是否重叠", "文字是否溢出", "图表类型是否匹配任务"],
    limitations: ["审美上限取决于模板和布局算法", "不适合生成写实插画"],
  },
  document_pipeline: {
    name: "document_pipeline",
    label: "Word/PDF 文档工具",
    category: "file_generator",
    readiness: "partial",
    purpose: "生成 Word、PDF、Markdown、TXT、JSON 等成果文件。",
    inputs: ["标题", "正文", "表格", "模板", "元数据"],
    outputs: ["DOCX", "PDF", "MD", "TXT", "JSON"],
    checks: ["文件是否可打开", "PDF 是否乱码", "标题层级是否正确", "表格是否破碎"],
    limitations: ["复杂论文级排版仍需模板系统继续增强"],
  },
  translation_pipeline: {
    name: "translation_pipeline",
    label: "学术翻译工具",
    category: "file_generator",
    readiness: "partial",
    purpose: "翻译学术文档，并尽量保持原文档结构和格式。",
    inputs: ["DOCX 文档", "翻译模式", "术语偏好", "模型档位"],
    outputs: ["翻译后的 DOCX"],
    checks: ["是否漏段", "术语是否一致", "数字和单位是否保留", "是否残留不该保留的原文"],
    limitations: ["旧版 .doc 需要用户转换为 .docx", "复杂图文混排会受解析能力限制"],
  },
  literature_pipeline: {
    name: "literature_pipeline",
    label: "文献分析工具",
    category: "file_reader",
    readiness: "partial",
    purpose: "读取论文全文，生成单篇精读、文献矩阵、主题归类和引用推荐。",
    inputs: ["PDF 全文", "DOCX 文献", "文献库元数据", "选中文件范围"],
    outputs: ["单篇精读", "文献矩阵", "主题分类", "证据摘要"],
    checks: ["是否读到全文", "是否混淆文献", "是否有原文证据", "是否说明未读全文原因"],
    limitations: ["扫描 PDF 依赖 OCR", "全文过长时需要分段和缓存"],
  },
  presentation_pipeline: {
    name: "presentation_pipeline",
    label: "PPT 工具",
    category: "file_generator",
    readiness: "partial",
    purpose: "从大纲、文献矩阵或用户内容生成学术汇报 PPT。",
    inputs: ["故事线", "逐页内容", "模板", "图表需求", "引用来源"],
    outputs: ["PPTX"],
    checks: ["文字是否溢出", "元素是否重叠", "页面是否过密", "图表是否支撑结论"],
    limitations: ["高质量版式需要继续建设模板和逐页视觉检查"],
  },
  spreadsheet_pipeline: {
    name: "spreadsheet_pipeline",
    label: "Excel 表格工具",
    category: "file_generator",
    readiness: "partial",
    purpose: "生成 Excel 表格、文献矩阵、统计结果和数据图表。",
    inputs: ["结构化数据", "表头", "工作表规划", "公式需求"],
    outputs: ["XLSX"],
    checks: ["列名是否稳定", "数据是否错位", "公式是否有效", "图表是否引用正确区域"],
    limitations: ["复杂宏和高级透视分析暂不作为主线能力"],
  },
  literature_library: {
    name: "literature_library",
    label: "文献库工具",
    category: "knowledge",
    readiness: "partial",
    purpose: "管理文献、文件夹、收藏、PDF 入库和文献元数据。",
    inputs: ["文献 ID", "文件夹 ID", "PDF", "元数据"],
    outputs: ["文献记录", "文件夹关系", "PDF 存储状态"],
    checks: ["目标文件夹是否正确", "是否重复保存", "PDF 是否真正入库"],
    limitations: ["Google Scholar 资源仍依赖插件和可下载 PDF 链接"],
  },
  project_workspace: {
    name: "project_workspace",
    label: "项目工作区",
    category: "knowledge",
    readiness: "partial",
    purpose: "管理科研项目、项目绑定资料、项目上下文和成果归档。",
    inputs: ["项目 ID", "项目名称", "绑定文件夹", "用户确认"],
    outputs: ["项目状态", "项目资料范围", "项目成果索引"],
    checks: ["是否误操作项目", "是否把其他项目资料混入当前项目"],
    limitations: ["项目成果中心还需要进一步统一"],
  },
  local_connector: {
    name: "local_connector",
    label: "本机连接器",
    category: "local_connector",
    readiness: "partial",
    purpose: "在用户授权后读取和打开本机文件，作为网页访问本地资料的安全通道。",
    inputs: ["授权文件夹", "本机文件路径", "用户选择"],
    outputs: ["文件列表", "文件全文", "文件二进制", "打开文件动作"],
    checks: ["连接器是否在线", "是否已授权", "文件类型是否可读", "路径是否属于授权范围"],
    limitations: ["用户未安装或未启动时不能读本机文件", ".doc/.ppt 等旧格式不能稳定解析"],
  },
  quality_checker: {
    name: "quality_checker",
    label: "质量检查",
    category: "quality_checker",
    readiness: "partial",
    purpose: "在交付前检查文件、图表、翻译和分析结果是否真的可用。",
    inputs: ["生成文件", "工具输出", "任务目标", "来源证据"],
    outputs: ["通过/失败", "问题原因", "修复建议"],
    checks: ["文件可打开", "没有乱码", "没有溢出", "内容没有跑题", "引用和证据一致"],
    limitations: ["目前先做基础自动检查，复杂视觉检查后续继续增强"],
  },
};

export function getToolDefinition(name: ToolName): ToolDefinition {
  return TOOL_REGISTRY[name];
}

export function getToolLabel(name: ToolName): string {
  return TOOL_REGISTRY[name]?.label ?? name;
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return CHAT_TOOL_NAMES.map((name) => TOOL_REGISTRY[name]).filter(
    (tool) => tool.category === category,
  );
}

export function defaultToolsForIntent(intent: IntentKind): ToolName[] {
  switch (intent) {
    case "generate_image":
      return ["gpt_image", "quality_checker"];
    case "visualization":
      return ["svg_visual_renderer", "quality_checker"];
    case "create_artifact":
      return ["document_pipeline", "quality_checker"];
    case "translate_document":
      return ["translation_pipeline", "document_pipeline", "quality_checker"];
    case "single_paper_reading":
    case "literature_matrix":
    case "file_analysis":
      return ["local_connector", "literature_pipeline", "quality_checker"];
    case "presentation_generation":
      return ["presentation_pipeline", "quality_checker"];
    case "data_analysis":
      return ["spreadsheet_pipeline", "quality_checker"];
    case "literature_library_operation":
      return ["literature_library", "quality_checker"];
    case "project_operation":
      return ["project_workspace"];
    case "local_file_operation":
      return ["local_connector", "quality_checker"];
    case "web_research":
      return ["web_search", "chat_model"];
    default:
      return ["chat_model"];
  }
}

export function summarizeToolDefinitions(tools: ToolName[]): string {
  return Array.from(new Set(tools))
    .map((name) => {
      const tool = getToolDefinition(name);
      return `${tool.label}：${tool.purpose}`;
    })
    .join("\n");
}
