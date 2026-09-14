const FULL_DOCUMENT_PATTERNS = [
  /(?:整篇|全文|整个|全篇).{0,12}(?:申请书|标书|项目|文档)/u,
  /(?:申请书|标书|项目|文档).{0,12}(?:整体|全局|全面|通篇|全文)/u,
  /(?:评价|审阅|分析|检查|评估).{0,8}(?:这|本|我的|当前)?(?:篇|份)?(?:申请书|标书|项目)/u,
  /(?:对|关于)(?:这|本|我的|当前)?(?:篇|份)?(?:申请书|标书|项目).{0,16}(?:评价|意见|建议|问题|修改)/u,
  /(?:overall|entire|whole|full).{0,20}(?:grant|application|proposal|document)/iu,
  /(?:grant|application|proposal|document).{0,20}(?:overall|holistic|as a whole)/iu,
  /(?:review|evaluate|assess|analyze).{0,20}(?:grant|application|proposal)/iu,
] as const;

export function requestsFullGrantDocumentAnalysis(question: string): boolean {
  const normalized = question.trim();
  return normalized.length > 0 && FULL_DOCUMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
