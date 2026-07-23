import type {
  InputScope,
  IntentKind,
  IntentPlan,
  IntentRouterInput,
  ToolName,
} from "@/lib/chat/intent-router";

export type ToolPlanStage =
  | "validate_scope"
  | "collect_inputs"
  | "parse_files"
  | "retrieve_context"
  | "analyze_content"
  | "generate_output"
  | "quality_check"
  | "compose_response";

export type ToolPlanStep = {
  id: string;
  stage: ToolPlanStage;
  title: string;
  detail: string;
  tools: ToolName[];
  required: boolean;
};

export type ToolPlan = {
  intent: IntentKind;
  scope: InputScope;
  outputType: IntentPlan["outputType"];
  steps: ToolPlanStep[];
  blockers: string[];
  warnings: string[];
  needsUserDecision: boolean;
  confirmationQuestion?: string;
};

function step(
  id: string,
  stage: ToolPlanStage,
  title: string,
  detail: string,
  tools: ToolName[],
  required = true,
): ToolPlanStep {
  return { id, stage, title, detail, tools, required };
}

function scopeDetail(plan: IntentPlan, input: IntentRouterInput): string {
  if (plan.inputScope === "current_project") {
    return input.projectName
      ? `只读取当前项目「${input.projectName}」绑定的资料。`
      : "需要先选择项目，避免把其他项目资料混入任务。";
  }
  if (plan.inputScope === "selected_folders") {
    return input.selectedFolderIds.length > 0
      ? `只读取已选择的 ${input.selectedFolderIds.length} 个文献文件夹。`
      : "需要先选择文献文件夹。";
  }
  if (plan.inputScope === "selected_files") {
    return "只读取用户本次勾选或拖入的文件。";
  }
  if (plan.inputScope === "uploaded_files") {
    return "只读取本次上传的文件。";
  }
  if (plan.inputScope === "web") {
    return "通过联网搜索工具获取外部资料，并保留来源。";
  }
  if (plan.inputScope === "literature_library") {
    return "读取文献库中与当前问题相关的记录。";
  }
  return "只根据当前问题回答，不自动带入项目资料。";
}

function requiresProjectOrSelection(plan: IntentPlan): boolean {
  return (
    plan.inputScope === "current_project" ||
    plan.inputScope === "selected_folders" ||
    plan.inputScope === "selected_files"
  );
}

function hasProjectOrSelection(input: IntentRouterInput): boolean {
  return Boolean(input.projectName) || input.selectedFolderIds.length > 0;
}

function highCostTools(plan: IntentPlan): ToolName[] {
  return plan.tools.filter(
    (tool) =>
      tool === "gpt_image" ||
      tool === "presentation_pipeline" ||
      tool === "document_pipeline" ||
      tool === "translation_pipeline" ||
      tool === "literature_pipeline",
  );
}

function buildIntentSteps(plan: IntentPlan): ToolPlanStep[] {
  switch (plan.intent) {
    case "generate_image":
      return [
        step(
          "image_brief",
          "collect_inputs",
          "整理图片需求",
          "把用户的自然语言要求转成可执行的图片规格，包括画面主题、用途、比例、风格和禁忌。",
          ["chat_model"],
        ),
        step(
          "image_generate",
          "generate_output",
          "调用图片模型",
          "使用 GPT Image 生成一张可直接用于汇报、文档或说明页的高质量图片。",
          ["gpt_image"],
        ),
      ];
    case "visualization":
      return [
        step(
          "visual_structure",
          "analyze_content",
          "确定图形结构",
          "先判断适合流程图、时间轴、鱼骨图、矩阵图还是数据图表，而不是只看关键词。",
          ["chat_model"],
        ),
        step(
          "visual_render",
          "generate_output",
          "生成可编辑图表",
          "用结构化图形工具生成 SVG/HTML 图表，后续可以继续编辑。",
          ["svg_visual_renderer"],
        ),
      ];
    case "translate_document":
      return [
        step(
          "translation_parse",
          "parse_files",
          "读取原文档",
          "解析用户选中的文档内容和基本版式，为保持原格式做准备。",
          ["local_connector", "translation_pipeline"],
        ),
        step(
          "translation_generate",
          "generate_output",
          "生成翻译文档",
          "按用户选择的纯英文或中英双语模式输出同格式文件，而不是只在聊天里给长文本。",
          ["translation_pipeline", "document_pipeline"],
        ),
      ];
    case "single_paper_reading":
      return [
        step(
          "paper_parse",
          "parse_files",
          "读取单篇全文",
          "读取用户选中的论文全文、图表说明和关键段落。",
          ["local_connector", "literature_pipeline"],
        ),
        step(
          "paper_analysis",
          "analyze_content",
          "生成精读结构",
          "按研究问题、技术路线、关键实验、结果证据、创新性和局限性整理。",
          ["literature_pipeline"],
        ),
      ];
    case "literature_matrix":
      return [
        step(
          "matrix_parse",
          "parse_files",
          "批量读取文献",
          "读取当前项目或已选文件夹中的论文，至少需要两篇文献。",
          ["local_connector", "literature_pipeline"],
        ),
        step(
          "matrix_generate",
          "analyze_content",
          "生成文献矩阵",
          "提取研究主题、方法、关键结果、结论、局限性以及与综述主题的关系。",
          ["literature_pipeline"],
        ),
      ];
    case "presentation_generation":
      return [
        step(
          "ppt_storyline",
          "analyze_content",
          "规划汇报故事线",
          "先生成页数、每页逻辑和证据需求，避免直接生成草稿式 PPT。",
          ["presentation_pipeline"],
        ),
        step(
          "ppt_create",
          "generate_output",
          "生成 PPT 文件",
          "套用模板、选择版式、控制文字密度，并尽量匹配图表证据。",
          ["presentation_pipeline"],
        ),
      ];
    case "web_research":
      return [
        step(
          "web_search",
          "retrieve_context",
          "联网检索资料",
          "检索最新网页、论文或官方资料，并记录来源。",
          ["web_search"],
        ),
        step(
          "web_answer",
          "compose_response",
          "整合带来源回答",
          "把检索结果整理成有出处、可验证的回答。",
          ["chat_model"],
        ),
      ];
    case "project_operation":
      return [
        step(
          "project_validate",
          "validate_scope",
          "确认项目操作",
          "确认要新建、重命名、删除或切换的项目，避免误操作。",
          ["project_workspace"],
        ),
      ];
    case "literature_library_operation":
      return [
        step(
          "library_validate",
          "validate_scope",
          "确认文献库操作",
          "确认目标文件夹、目标文献和操作类型，避免移动或删除错误文献。",
          ["literature_library"],
        ),
      ];
    case "local_file_operation":
      return [
        step(
          "local_permission",
          "validate_scope",
          "确认本机授权",
          "确认本机连接器已启用，并只读取用户授权的本地路径。",
          ["local_connector"],
        ),
      ];
    default:
      return [
        step(
          "chat_answer",
          "compose_response",
          "直接回答",
          "根据当前问题和必要上下文组织回答。",
          ["chat_model"],
        ),
      ];
  }
}

export function buildToolPlan(
  intentPlan: IntentPlan,
  input: IntentRouterInput,
): ToolPlan {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const steps: ToolPlanStep[] = [
    step(
      "scope_guard",
      "validate_scope",
      "确认读取范围",
      scopeDetail(intentPlan, input),
      ["chat_model"],
    ),
    ...buildIntentSteps(intentPlan),
  ];

  if (intentPlan.tools.includes("quality_checker")) {
    steps.push(
      step(
        "quality_check",
        "quality_check",
        "质量检查",
        "检查输出是否跑题、乱码、裁切、文字溢出、引用缺失或工具调用不完整。",
        ["quality_checker"],
      ),
    );
  }

  steps.push(
    step(
      "response_compose",
      "compose_response",
      "交付结果",
      "把工具结果整合成用户能理解、能继续编辑或下载的成果。",
      ["chat_model"],
    ),
  );

  if (requiresProjectOrSelection(intentPlan) && !hasProjectOrSelection(input)) {
    blockers.push("这个任务需要先选择项目、文件夹或文件，否则容易读取错资料。");
  }

  if (
    intentPlan.intent === "literature_matrix" &&
    intentPlan.inputScope === "selected_folders" &&
    input.selectedFolderIds.length === 0
  ) {
    blockers.push("文献矩阵至少需要先选择一个包含两篇以上文献的资料范围。");
  }

  if (intentPlan.constraints.requireProjectIsolation) {
    warnings.push("本次任务会启用项目隔离：默认不读取其他项目或其他文件夹。");
  }

  const expensive = highCostTools(intentPlan);
  if (expensive.length > 0) {
    warnings.push(
      "该任务会调用较重的工具。执行前应向用户说明预计 token 和可能产生的额外费用。",
    );
  }

  const needsUserDecision =
    blockers.length > 0 ||
    intentPlan.needsConfirmation ||
    (intentPlan.confidence < 0.55 && intentPlan.intent !== "conversation");

  return {
    intent: intentPlan.intent,
    scope: intentPlan.inputScope,
    outputType: intentPlan.outputType,
    steps,
    blockers,
    warnings,
    needsUserDecision,
    confirmationQuestion:
      intentPlan.confirmationQuestion ||
      blockers[0] ||
      (intentPlan.confidence < 0.55
        ? "我对任务理解还不够确定，请补充要处理的文件、项目或输出格式。"
        : undefined),
  };
}

