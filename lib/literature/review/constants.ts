export const REVIEW_PERSPECTIVE_OPTIONS = [
  "技术路线综述",
  "方法学比较",
  "应用前景分析",
  "产业化分析",
  "开题报告背景",
  "博士论文绪论",
  "组会汇报",
  "自定义",
] as const;

export const REVIEW_AUDIENCE_OPTIONS = [
  "导师",
  "课题组",
  "开题委员会",
  "同领域研究者",
  "跨学科读者",
] as const;

export const REVIEW_TIME_RANGE_OPTIONS = [
  "全部文献",
  "近1年",
  "近3年",
  "近5年",
  "自定义",
] as const;

export const REVIEW_SECTION_OPTIONS = [
  "研究背景",
  "研究主题分类",
  "技术路线",
  "代表性文献",
  "方法对比",
  "实验结果对比",
  "当前瓶颈",
  "未来方向",
  "总结",
  "参考文献",
] as const;

export const REVIEW_OUTPUT_TYPE_OPTIONS = [
  "综述文章",
  "开题报告背景",
  "博士论文绪论",
  "组会汇报稿",
  "PPT大纲",
  "PPTX",
] as const;

export const REVIEW_LANGUAGE_OPTIONS = ["中文", "英文", "中英双语"] as const;

export const REVIEW_LENGTH_OPTIONS = [
  "简短版",
  "标准版",
  "详细版",
  "自定义字数",
] as const;

export const REVIEW_MIN_PAPER_COUNT = 3;

export const REVIEW_LENGTH_WORD_TARGETS: Record<
  Exclude<(typeof REVIEW_LENGTH_OPTIONS)[number], "自定义字数">,
  string
> = {
  简短版: "1500-2500 字",
  标准版: "3000-5000 字",
  详细版: "6000-9000 字",
};

export const REVIEW_TIME_RANGE_YEARS: Record<
  Exclude<(typeof REVIEW_TIME_RANGE_OPTIONS)[number], "全部文献" | "自定义">,
  number
> = {
  近1年: 1,
  近3年: 3,
  近5年: 5,
};
