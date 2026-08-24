export const AI_OPERATIONS = Object.freeze({
  chat: Object.freeze({
    conversation: "chat.conversation",
    webResearch: "chat.web_research",
    fileAnalysis: "chat.file_analysis",
    dataAnalysis: "chat.data_analysis",
    visualization: "chat.visualization",
    artifact: "chat.artifact",
  }),
  document: Object.freeze({
    requestUnderstand: "request.understand",
    templateMatch: "template.match",
    outlineThesis: "outline.thesis",
    outlineSectionIndex: "outline.section_index",
    outlineFigureIntents: "outline.figure_intents",
    outlineSectionPlan: "outline.section_plan",
    componentGenerate: "component.generate",
    figureGenerate: "document.figure.generate",
  }),
  grant: Object.freeze({
    assistantChat: "grant.assistant.chat",
    editSessionTurn: "grant.edit_session.turn",
    diagnosticSemantic: "diagnostic.semantic",
    diagnosticArgumentMapping: "diagnostic.argument_mapping",
    diagnosticRootDiagnosis: "diagnostic.root_diagnosis",
    diagnosticFactMapping: "diagnostic.fact_mapping",
    diagnosticScientificReview: "diagnostic.scientific_review",
    diagnosticNarrativeReview: "diagnostic.narrative_review",
  }),
} as const);

type ValueOf<T> = T[keyof T];
export type ChatAiOperation = ValueOf<typeof AI_OPERATIONS.chat>;
export type DocumentAiOperation = ValueOf<typeof AI_OPERATIONS.document>;
export type GrantAiOperation = ValueOf<typeof AI_OPERATIONS.grant>;
export type RegisteredAiOperation = ChatAiOperation | DocumentAiOperation | GrantAiOperation;

export const REGISTERED_AI_OPERATIONS = Object.freeze([
  ...Object.values(AI_OPERATIONS.chat),
  ...Object.values(AI_OPERATIONS.document),
  ...Object.values(AI_OPERATIONS.grant),
] as const);

const REGISTERED_OPERATION_SET: ReadonlySet<string> = new Set(REGISTERED_AI_OPERATIONS);

export function isRegisteredAiOperation(value: unknown): value is RegisteredAiOperation {
  return typeof value === "string" && REGISTERED_OPERATION_SET.has(value);
}

export function assertRegisteredAiOperation(value: unknown): RegisteredAiOperation {
  if (!isRegisteredAiOperation(value)) {
    throw new Error(`AI operation is not registered: ${String(value)}`);
  }
  return value;
}

export const CHAT_TASK_OPERATION = Object.freeze({
  conversation: AI_OPERATIONS.chat.conversation,
  web_research: AI_OPERATIONS.chat.webResearch,
  file_analysis: AI_OPERATIONS.chat.fileAnalysis,
  data_analysis: AI_OPERATIONS.chat.dataAnalysis,
  visualization: AI_OPERATIONS.chat.visualization,
  artifact: AI_OPERATIONS.chat.artifact,
} as const);

export type RegisteredChatTaskKind = keyof typeof CHAT_TASK_OPERATION;

export function operationForChatTaskKind(taskKind: RegisteredChatTaskKind): ChatAiOperation {
  return CHAT_TASK_OPERATION[taskKind];
}
