import type { ChatMessage } from "@/lib/ai/types";
import { getTextFromMessageContent } from "@/lib/ai/types";

export type ChatTaskKind =
  | "conversation"
  | "web_research"
  | "file_analysis"
  | "data_analysis"
  | "artifact";

export type ChatTaskRoute = {
  kind: ChatTaskKind;
  status: string;
  autoWebSearch: boolean;
  useCodeInterpreter: boolean;
  systemInstruction: string;
};

const WEB_PATTERN =
  /(最新|今天|目前|近期|新闻|价格|政策|法规|标准|搜索|检索|查找|核实|来源|引用|链接|图片|照片|地图|火点|山火|天气|地震|卫星|latest|current|today|news|price|search|verify|source|citation|image|photo|map)/i;
const DATA_PATTERN =
  /(数据分析|统计|计算|对比数据|趋势|相关性|回归|均值|中位数|标准差|柱状图|折线图|饼图|散点图|可视化|chart|plot|graph|calculate|statistics|regression|correlation)/i;
const ARTIFACT_PATTERN =
  /(生成|导出|制作|创建).{0,12}(word|docx|pdf|ppt|pptx|表格|图表|报告|文档|幻灯片)|(export|create|generate).{0,12}(document|pdf|ppt|slides|report)/i;
const FILE_CONTEXT_PATTERN =
  /(?:Attached document|Document context|附件|文件名|originalLength|truncated)/i;
const TABULAR_CONTEXT_PATTERN =
  /\.(?:csv|xlsx|xls)\b|(?:CSV|spreadsheet|worksheet|工作表|电子表格)/i;

function lastUserText(messages: ChatMessage[]): string {
  const message = [...messages].reverse().find((item) => item.role === "user");
  return message ? getTextFromMessageContent(message.content) : "";
}

export function routeChatTask(messages: ChatMessage[]): ChatTaskRoute {
  const query = lastUserText(messages);
  const hasFileContext = FILE_CONTEXT_PATTERN.test(query);
  const hasTabularContext = TABULAR_CONTEXT_PATTERN.test(query);

  if (hasTabularContext && (DATA_PATTERN.test(query) || hasFileContext)) {
    return {
      kind: "data_analysis",
      status: "已识别为数据分析，正在核对字段并计算",
      autoWebSearch: false,
      useCodeInterpreter: true,
      systemInstruction: [
        "This is a data-analysis task.",
        "Use code interpreter for calculations when useful.",
        "Never invent numeric values. State which columns or rows support every result.",
        "When a chart improves understanding, include one fenced `chart` JSON block.",
        'Schema: {"type":"bar|line","title":"...","labels":["..."],"series":[{"name":"...","values":[1,2]}]}.',
        "Use verified values only and explain the conclusion immediately after the chart.",
      ].join("\n"),
    };
  }

  if (hasFileContext) {
    return {
      kind: "file_analysis",
      status: "已识别为文件分析，正在读取证据",
      autoWebSearch: false,
      useCodeInterpreter: false,
      systemInstruction: [
        "This is a user-file analysis task.",
        "Ground claims in supplied file evidence and distinguish evidence from inference.",
        "Point to relevant headings, tables, figures, passages, or data fields when possible.",
        "If evidence is missing or truncated, say so directly.",
      ].join("\n"),
    };
  }

  if (ARTIFACT_PATTERN.test(query)) {
    return {
      kind: "artifact",
      status: "已识别为成果制作，正在组织可交付内容",
      autoWebSearch: WEB_PATTERN.test(query),
      useCodeInterpreter: DATA_PATTERN.test(query),
      systemInstruction: [
        "This is an artifact-creation task.",
        "Produce a complete reusable deliverable rather than generic advice.",
        "Use clear hierarchy, compact sections, and tables or charts when useful.",
        "Do not claim a downloadable file exists unless a tool actually created one.",
      ].join("\n"),
    };
  }

  if (WEB_PATTERN.test(query)) {
    return {
      kind: "web_research",
      status: "已识别为联网研究，正在检索并核对来源",
      autoWebSearch: true,
      useCodeInterpreter: false,
      systemInstruction: [
        "This is a web-research task.",
        "Search current, primary, and authoritative sources.",
        "Synthesize rather than list results and attach citations to supported claims.",
        "Clearly label uncertainty or inference.",
      ].join("\n"),
    };
  }

  return {
    kind: "conversation",
    status: "正在理解问题并组织回答",
    autoWebSearch: false,
    useCodeInterpreter: false,
    systemInstruction:
      "Answer directly. Add structure only where it improves comprehension.",
  };
}
