const zh = (value: string) =>
  JSON.parse(`"${value}"`) as string;

export const REVIEW_MODEL_OPTIONS = [
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    badge: "经济",
    description: "速度快、费用低，适合快速大纲和摘要综述。",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    badge: "均衡",
    description: "质量与成本平衡，适合常规学术综述。",
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    badge: "高质量",
    description: "质量最高、费用较高，适合最终成果。",
  },
] as const;

export const REVIEW_MODEL_IDS = REVIEW_MODEL_OPTIONS.map((option) => option.id);

export const REVIEW_PERSPECTIVE_OPTIONS = [
  zh("\\u6280\\u672f\\u8def\\u7ebf\\u7efc\\u8ff0"),
  zh("\\u65b9\\u6cd5\\u5b66\\u6bd4\\u8f83"),
  zh("\\u5e94\\u7528\\u524d\\u666f\\u5206\\u6790"),
  zh("\\u4ea7\\u4e1a\\u5316\\u5206\\u6790"),
  zh("\\u5f00\\u9898\\u62a5\\u544a\\u80cc\\u666f"),
  zh("\\u535a\\u58eb\\u8bba\\u6587\\u7eea\\u8bba"),
  zh("\\u7ec4\\u4f1a\\u6c47\\u62a5"),
  zh("\\u81ea\\u5b9a\\u4e49"),
] as const;

export const REVIEW_AUDIENCE_OPTIONS = [
  zh("\\u5bfc\\u5e08"),
  zh("\\u8bfe\\u9898\\u7ec4"),
  zh("\\u5f00\\u9898\\u59d4\\u5458\\u4f1a"),
  zh("\\u540c\\u9886\\u57df\\u7814\\u7a76\\u8005"),
  zh("\\u8de8\\u5b66\\u79d1\\u8bfb\\u8005"),
] as const;

export const REVIEW_SECTION_OPTIONS = [
  zh("\\u7814\\u7a76\\u80cc\\u666f"),
  zh("\\u7814\\u7a76\\u4e3b\\u9898\\u5206\\u7c7b"),
  zh("\\u6280\\u672f\\u8def\\u7ebf"),
  zh("\\u4ee3\\u8868\\u6027\\u6587\\u732e"),
  zh("\\u65b9\\u6cd5\\u5bf9\\u6bd4"),
  zh("\\u5b9e\\u9a8c\\u7ed3\\u679c\\u5bf9\\u6bd4"),
  zh("\\u5f53\\u524d\\u74f6\\u9888"),
  zh("\\u672a\\u6765\\u65b9\\u5411"),
  zh("\\u603b\\u7ed3"),
  zh("\\u53c2\\u8003\\u6587\\u732e"),
] as const;

export const REVIEW_OUTPUT_TYPE_OPTIONS = [
  zh("\\u7efc\\u8ff0\\u6587\\u7ae0"),
  zh("\\u5f00\\u9898\\u62a5\\u544a\\u80cc\\u666f"),
  zh("\\u535a\\u58eb\\u8bba\\u6587\\u7eea\\u8bba"),
  zh("\\u7ec4\\u4f1a\\u6c47\\u62a5\\u7a3f"),
  "PPT",
  "PPTX",
] as const;

export const REVIEW_LANGUAGE_OPTIONS = [
  zh("\\u4e2d\\u6587"),
  zh("\\u82f1\\u6587"),
  zh("\\u4e2d\\u82f1\\u53cc\\u8bed"),
] as const;

export const REVIEW_LENGTH_OPTIONS = [
  zh("\\u7b80\\u77ed\\u7248"),
  zh("\\u6807\\u51c6\\u7248"),
  zh("\\u8be6\\u7ec6\\u7248"),
  zh("\\u81ea\\u5b9a\\u4e49\\u5b57\\u6570"),
] as const;

export const REVIEW_MIN_PAPER_COUNT = 3;

export const REVIEW_MIN_PAPER_COUNT_ERROR =
  zh("\\u6240\\u9009\\u6587\\u732e\\u5939\\u4e2d\\u7684\\u6587\\u732e\\u6570\\u91cf\\u4e0d\\u8db3\\uff0c\\u81f3\\u5c11\\u9700\\u8981 3 \\u7bc7\\u6587\\u732e\\u3002");

export const REVIEW_LENGTH_WORD_TARGETS: Record<string, string> = {
  [REVIEW_LENGTH_OPTIONS[0]]: "1500-2500 字",
  [REVIEW_LENGTH_OPTIONS[1]]: "3000-5000 字",
  [REVIEW_LENGTH_OPTIONS[2]]: "6000-9000 字",
};
