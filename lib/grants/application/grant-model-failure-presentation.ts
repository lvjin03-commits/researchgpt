import type { GrantModelFailureCategory } from "../model-execution/operation-registry.ts";

export type GrantModelFailureStage = "memory_build" | "semantic_planning" |
  "context_admission" | "original_retrieval" | "answer_generation" | "persistence";

export function presentGrantModelFailure(input: {
  category: GrantModelFailureCategory;
  failureStage?: GrantModelFailureStage;
}) {
  const stage = input.failureStage;
  switch (input.category) {
    case "planning_capacity_exceeded":
      return { status: 422, retryable: false, message:
        "申请书全文记忆索引压缩后仍超过本轮规划容量，系统已在回答生成前停止。请缩小问题范围后重试。" };
    case "answer_capacity_exceeded":
      return { status: 422, retryable: false, message:
        "所需原文与诊断即使分层后仍超过本轮容量；系统没有丢弃材料，也没有返回不完整结论。请缩小审查范围后重试。" };
    case "output_truncated":
      return { status: 502, retryable: true, message: stage === "memory_build"
        ? "申请书全文记忆生成达到输出上限，未保存不完整记忆。请重新发送问题。"
        : stage === "semantic_planning"
          ? "本轮语义规划达到输出上限，尚未进入回答生成。请重新发送问题。"
          : "回答生成达到输出上限，系统没有展示或保存不完整回答。请缩小问题范围后重试。" };
    case "structured_output_invalid":
    case "structured_reference_invalid":
      return { status: 502, retryable: true, message: stage === "semantic_planning"
        ? "本轮语义规划未形成有效结构，系统没有使用该结果。请重新发送问题。"
        : "模型结果未通过结构或来源校验，系统没有展示该结果。请重新发送问题。" };
    case "content_filtered":
      return { status: 422, retryable: false, message: "本轮内容被模型安全策略拦截，未生成回答。请调整问题表述。" };
    case "provider_refusal":
      return { status: 422, retryable: false, message: "模型拒绝了本轮请求，未生成回答。请调整问题范围或表述。" };
    case "provider_rate_limited":
      return { status: 429, retryable: true, message: "当前 AI 请求较多，供应商触发限流，请稍后重试。" };
    case "provider_transient_error":
      return { status: 503, retryable: true, message: "AI 供应商出现临时故障，请稍后重试。" };
    case "provider_unavailable":
      return { status: 503, retryable: true, message: "当前无法连接 AI 供应商，请稍后重试。" };
    case "provider_contract_error":
      return { status: 502, retryable: false, message: "模型或调用参数与当前配置不兼容，系统已停止重试。" };
    case "internal_contract_error":
      return { status: 500, retryable: false, message: stage === "original_retrieval"
        ? "当前申请书原文或诊断引用无法安全解析，模型尚未继续回答。"
        : "申请书上下文装配或结果校验失败，系统已停止本轮处理。" };
    case "evidence_authorization_changed":
    case "figure_authorization_changed":
      return { status: 409, retryable: false, message: "本轮处理期间授权状态发生变化，请确认来源授权后重新发送。" };
    case "web_source_unavailable":
      return { status: 503, retryable: true, message: "本轮所需联网来源暂时不可用，请稍后重试。" };
    default:
      return { status: 503, retryable: true, message: "本轮 AI 处理未完成，请稍后重试。" };
  }
}
