# ResearchGPT 当前文档生成主链审计

审计基准：`97fbfdd` 之后的当前工作区代码。

本文件描述的是代码**现在实际如何运行**，不是目标架构。为避免把空行、括号和类型声明淹没在正文中，逐行明细拆分到以下 CSV：

| 明细 | 内容 |
|---|---|
| `document-mainline-file-inventory.csv` | 主链 64 个文件及行数 |
| `document-mainline-symbol-index.csv` | 1,354 个函数、类型、接口、方法和导入的起止行 |
| `document-mainline-line-index.csv` | 17,832 行逐行索引：文件、行号、所属符号、行类型、作用、代码摘要 |

## 1. 当前系统实际上有四个文件入口

| 入口 | 用户动作 | 服务端入口 | 是否经过结构化 DOCX |
|---|---|---|---|
| 聊天生成新文件 | 在聊天框要求生成 Word/PDF/Excel 等 | `POST /api/chat` | 只有专用 DOCX 分支经过 `DocumentSpec` |
| 导出上一轮回答 | 在下一轮说“生成 Word/导出”并被判定为承接上文 | `POST /api/chat` | 否，直接把上一轮回答交给 `createExport` |
| 普通回答后自动导出 | 请求被当成普通聊天，但仍识别出文件格式 | `POST /api/chat` | 否，先生成聊天正文，再导出 |
| 独立导出对话框 | 用户通过独立导出界面导出已有内容 | `POST /api/export` | 否，独立导出接口自行执行清洗、生成和存储 |

这四个入口共用部分底层渲染代码，但上游的内容来源、模板选择、校验和错误处理并不相同。

## 2. 用户点击发送到 `/api/chat`

| 顺序 | 文件与位置 | 实际功能 | 输出/下一步 |
|---:|---|---|---|
| 1 | `components/chat-input.tsx` | 收集输入文字、附件、联网开关、文献库开关及模型档位 | `ChatSendPayload` |
| 2 | `components/chat-shell.tsx:1536` `handleSend` | 接收发送事件，判断是否为空、是否正在生成，处理特殊工具操作 | 调用聊天提交逻辑 |
| 3 | `components/chat-shell.tsx:95` | 把浏览器 `File[]` 转成界面附件对象 | 用于立即显示用户消息 |
| 4 | `components/chat-shell.tsx:102` | 把发送内容转换成 API 用户消息 | `ChatMessage` |
| 5 | `components/chat-shell.tsx:112` | 把发送内容转换成界面历史消息 | `DisplayChatMessage` |
| 6 | `components/chat-shell.tsx:1120` | 使用 `buildChatApiMessages` 合并历史消息和当前消息 | API 消息数组 |
| 7 | `components/chat-shell.tsx:1168` | 调用 `streamChatResponse` | 进入客户端请求层 |
| 8 | `components/chat-shell.tsx:1182` | 将服务端 `status` 事件写到活动状态 | 用户看到“执行规划”等状态 |
| 9 | `components/chat-shell.tsx:1226` | 接收独立图片生成事件 | 在聊天中显示图片 |
| 10 | `lib/chat/client.ts:172` | 负责附件预处理、请求 `/api/chat`、读取 NDJSON 流 | 将事件回调给界面 |

## 3. 附件预处理链

如果本轮包含附件，客户端不会直接把文件二进制发给 `/api/chat`，而是先经过附件接口。

| 顺序 | 文件与位置 | 实际功能 |
|---:|---|---|
| 1 | `lib/chat/client.ts:117` | 先把附件上传到 Supabase Storage，取得存储元数据 |
| 2 | `lib/chat/client.ts:126` | 请求 `POST /api/chat/attachments` |
| 3 | `app/api/chat/attachments/route.ts:90` | 验证登录、解析 multipart/form-data、验证消息和文件 |
| 4 | `app/api/chat/attachments/route.ts:121` | 调用 `prepareChatMessages` |
| 5 | `lib/chat/server/prepare-messages.ts:12` | 根据有没有附件选择是否动态加载服务端解析模块 |
| 6 | `lib/chat/server/attachments.ts:8` | 按文件类型调用文档或图片解析器 |
| 7 | `lib/documents/parser.ts:96` | 识别 PDF、DOCX、TXT 等格式并提取文本 |
| 8 | `lib/images/image.ts:54` | 解析图片并转换成模型消息中的图片内容 |
| 9 | `lib/chat/server/attachments.ts` | 把解析文本或图片注入最后一条用户消息 |
| 10 | `app/api/chat/attachments/route.ts` | 返回已经注入附件内容的消息数组 |
| 11 | `lib/chat/client.ts` | 再把处理后的消息发送给 `/api/chat` |

附件在这里已经变成模型上下文。后面的文档生成器本身不再读取原始浏览器 `File`。

## 4. `/api/chat` 进入流式响应之前

`app/api/chat/route.ts:1361` 是当前主入口。它在创建响应流以前依次执行：

| 顺序 | 当前代码 | 作用 | 可能提前失败 |
|---:|---|---|---|
| 1 | `requireChatUser()` | 从 Supabase Cookie 会话取得用户 | 未登录返回 401 |
| 2 | `createClient()` | 建立当前用户的 Supabase 客户端 | 配置或会话错误 |
| 3 | `assertDailyAiBudgetAvailable()` | 检查每日 AI 预算 | 超预算终止 |
| 4 | `request.json()` | 读取请求体 | JSON 错误终止 |
| 5 | 模型档位解析 | 选择 economy/standard 等模型配置 | 无效值回退默认 |
| 6 | 开关解析 | 读取联网、文献库、文件夹和上下文模式 | 清洗不合法值 |
| 7 | `sanitizeIncomingChatMessages()` | 删除空消息、非法角色和 UI 元数据 | 严重非法消息终止 |
| 8 | `validateChatMessages()` | 执行模型消息格式验证 | 格式不合法终止 |
| 9 | `withModelIdentity()` | 添加模型身份说明 | 修改系统提示 |
| 10 | `withResponseStyle()` | 添加统一回答风格 | 修改系统提示 |
| 11 | 提取 `query` | 找最后一条用户消息的文本部分 | 后续所有判断的主要输入 |
| 12 | `buildContextBundle()` | 汇总当前请求、上一轮结论、上一轮输出、文件范围和记忆 | `ContextBundle` |
| 13 | `routeIntent()` | 得到意图、输入范围、输出类型、置信度和规划来源 | `IntentPlan` |
| 14 | `buildToolPlan()` | 根据意图构造工具步骤、阻塞项和确认问题 | `ToolPlan` |
| 15 | `exportFormatsFromIntentPlan()` | 再次结合用户文本和意图推断 DOCX/PDF/XLSX 等格式 | `requestedExportFormats` |
| 16 | `previousAssistantTextBeforeLastUser()` | 读取最后一条用户消息以前最近的助手正文 | 上一轮导出候选源 |
| 17 | `shouldUsePreviousAssistantAsSource()` | 用查询文本、格式和上一轮内容判断是否承接上文 | 可能覆盖 Router 语义 |
| 18 | `shouldExportPreviousAssistant` | 格式非空且上一轮内容被选为资料源 | 决定是否走早退分支 |
| 19 | `createDocumentGenerationTrace()` | 文件请求创建日志任务 ID | 日志写入失败不阻断生成 |
| 20 | `executeToolPlan()` | 读取项目、文献、文件等工具上下文 | 可能返回阻塞消息 |
| 21 | `chatRouteFromIntent()` | 把语义意图映射成旧 `ChatTaskRoute` | 再次形成任务类别 |
| 22 | 文献库上下文判断 | 结合开关、文件夹和正则判断是否读文献库 | 可能引入额外证据 |
| 23 | 联网判断 | 显式联网或 Router 自动联网 | 影响后续模型调用 |
| 24 | 组装系统消息 | 注入任务指令、上下文、导出说明和科学图片规则 | 形成最终模型上下文 |
| 25 | `applyChatContextBudget()` | 对消息进行上下文预算裁剪 | 较早消息可能被压缩或移除 |
| 26 | `intentRequestsGptImage()` | 判断是否是独立图片生成请求 | 决定图片早退分支 |
| 27 | `new ReadableStream()` | 创建 NDJSON 流式响应 | 后续错误只能通过流内事件返回 |

重要事实：`routeIntent()` 不是唯一决策者。它之后还有文件格式推断、上一轮资料源判断、旧任务路由和专用文件模式判断。

## 5. Intent Router 内部顺序

`lib/chat/intent-router.ts:883` 的执行优先级如下：

| 优先级 | 分支 | 说明 |
|---:|---|---|
| 1 | `routeSafetyInterception()` | 先处理安全拦截 |
| 2 | `routeContextBundleFastPath()` | 根据 ContextBundle 和本地规则直接返回，不调用模型 |
| 3 | 检查 Router 模型客户端 | 未配置则进入本地规则 |
| 4 | Router 模型 | 把最近对话和 ContextBundle 发给模型，要求 JSON 意图 |
| 5 | `planFromRecord()` | 解析并规范模型输出 |
| 6 | `routeFastPath()` | 模型输出无效或调用失败时再次执行本地快速规则 |
| 7 | `fallbackIntentPlan()` | 最终使用旧任务路由或图片规则兜底 |

`queryUsesPreviousOutputAsSource()` 同时被 ContextBundle 快速路径和本地快速路径使用。因此即使模型 Router 能正确理解，新请求仍可能在模型调用前被本地快速路径截走。

## 6. Tool Planner 与 Tool Executor

| 模块 | 功能 | 不负责 |
|---|---|---|
| `lib/chat/tool-planner.ts:328` | 将 IntentPlan 转成 validate、collect、parse、retrieve、analyze、generate、quality、compose 步骤 | 不实际生成文件 |
| `lib/chat/tool-registry.ts` | 定义工具名称、类别、标签和默认工具 | 不执行工具 |
| `lib/chat/tool-executor.ts:199` | 执行当前已有的项目/文件夹/上下文工具，产生状态和上下文消息 | 不调用 DOCX 渲染器 |

如果 Executor 返回 `blockingMessage`，流会告诉用户任务暂停并结束。如果 ToolPlan 要求用户确认，流也会结束。两者都发生在文件内容生成之前。

## 7. 流开始后的提前分支

| 顺序 | 条件 | 行为 |
|---:|---|---|
| 1 | 有日志任务 | 发送“文件任务编号”状态 |
| 2 | Tool Executor 有状态 | 逐条发送状态 |
| 3 | 使用文献库 | 发送匹配文献数量 |
| 4 | 始终 | 发送任务调度、Token 估算和执行规划卡 |
| 5 | `blockingMessage` | 输出阻塞原因，关闭流 |
| 6 | `needsUserDecision` | 输出确认问题，关闭流 |
| 7 | 独立图片请求 | 调用 GPT Image、上传 Storage、发送图片，关闭流 |
| 8 | `shouldExportPreviousAssistant` | 进入上一轮回答直接导出，关闭流 |
| 9 | 否则 | 定义模型生成函数和文件生成函数，再判断专用文件模式 |

这些是有顺序的早退分支。前面的分支一旦命中，后面的结构化文档流程完全不会运行。

## 8. 分支 A：上一轮回答直接导出

触发条件：

```text
requestedExportFormats 非空
AND
shouldUsePreviousAssistantSource 为 true
```

实际步骤：

| 顺序 | 功能 |
|---:|---|
| 1 | 从上一轮助手正文第一行或当前查询生成文件标题 |
| 2 | 日志记录 `legacy_previous_assistant_export` |
| 3 | 对每个请求格式调用 `createExport` |
| 4 | `content` 直接使用上一轮助手正文 |
| 5 | metadata 标记 `chat-follow-up-export` |
| 6 | 生成下载链接或可恢复错误行 |
| 7 | 至少一个文件成功则日志任务成功，否则失败 |
| 8 | 输出“已按上一条回答生成文件”并关闭流 |

该分支不会执行：

- 模板语义规划；
- `DocumentSpec` 生成；
- `DocumentSpec` 校验；
- 文档图片生成；
- 结构化组件生成。

## 9. 分支 B：专用文件生成模式

`shouldUseDedicatedArtifactMode()` 根据 IntentPlan、格式和是否已经走上一轮导出来判断。命中后执行以下流程。

### 9.1 每个格式的准备

| 顺序 | 功能 |
|---:|---|
| 1 | `selectExportTemplateId()` 用查询和格式选择旧 `ArtifactTemplateId` |
| 2 | DOCX 调用 `resolveDocumentTemplate()` 选择新的文档模板 |
| 3 | 文档模板的 `rendererTemplateId` 再映射回旧渲染模板 |
| 4 | 日志保存文档模板 ID 和版本 |
| 5 | 调用 `generateArtifactSource()` |

这里同时存在两套模板身份：

- `DocumentTemplate.id/version/source`：规划和结构校验使用；
- `ArtifactTemplateId/rendererTemplateId`：底层导出渲染使用。

### 9.2 DOCX 的语义规划

`generateSemanticPlan()`：

| 顺序 | 代码功能 |
|---:|---|
| 1 | `createDocumentPlan()` 根据查询、模板和最大图片数创建本地基础计划 |
| 2 | `semanticDocumentPlanPrompt()` 把基础计划转成规划提示 |
| 3 | 单独调用一次 `openResponsesChatStream()` |
| 4 | 关闭联网和 Code Interpreter |
| 5 | 最多使用 3,000 输出 Token |
| 6 | 收集规划文本并记录用量 |
| 7 | `applySemanticDocumentPlan()` 尝试把模型规划合并回基础计划 |
| 8 | 模型规划无效时保留基础计划的部分或全部内容 |

计划包含：

- 文档类型、语言和主题；
- 是否需要摘要和参考文献；
- 模板组件任务；
- 章节角色、标题意图和要点；
- 视觉意图和最大图片数量。

### 9.3 完整 DocumentSpec 生成与最多四次重写

`generateArtifactSource()` 对 DOCX 的核心循环：

| 尝试 | 输入 | 校验 | 失败后 |
|---:|---|---|---|
| 1 | 专用文件提示＋DocumentPlan | 解析 JSON、验证完整 DocumentSpec | 构造完整重写提示 |
| 2 | 原上下文＋上次完整输出＋错误列表 | 同上 | 再次完整重写 |
| 3 | 同上 | 同上 | 再次完整重写 |
| 4 | 同上 | 同上 | 不再重试，返回最后一次输出 |

每次调用都：

- 使用完整模型最大输出 Token；
- 如果允许联网，则每次都可以联网；
- 收集一份新的完整响应；
- 对结构化 DOCX 不追加旧内容，而是用本次 `chunk` 覆盖 `source`；
- 将 `incomplete` 视为未通过；
- 记录这是第几次尝试以及是否全文重写。

`buildDocumentSpecRepairMessages()` 明确要求：

```text
Rewrite the complete DocumentSpec.
Do not return a partial patch.
```

所以当前不存在“只补摘要”或“只修图片 ID”的代码。

### 9.4 `parseDocumentSpec()`

负责：

1. 去掉可能存在的 Markdown JSON 围栏；
2. 找 JSON 对象边界；
3. `JSON.parse`；
4. 逐字段读取模板、语言、类型、标题、摘要、关键词；
5. 解析章节和每种 block；
6. 解析参考文献；
7. 解析 visualRequests；
8. 任意关键形状不符合时返回 `null`。

### 9.5 `validateDocumentSpec()`

验证范围：

| 类别 | 检查 |
|---|---|
| 身份 | 模板 ID、模板版本、语言、文档类型 |
| 标题 | 非空、不是命令式标题、长度和内容 |
| 摘要 | 模板要求时必须存在且达到要求 |
| 关键词 | 数量与内容 |
| 章节 | 规划章节是否存在、ID 是否匹配、层级是否合法 |
| 段落 | 文本非空 |
| 列表 | 项目非空 |
| 表格 | 标题、列、行和列数一致性 |
| 图片占位 | visual block 是否指向真实请求 |
| 图片请求 | 是否指向存在的章节、字段是否完整 |
| 引用 | 模板要求时是否存在，字段是否完整 |
| 成品边界 | 是否出现 placeholder、visualSpecs、evidenceType 等内部内容 |

### 9.6 最终校验与图片

四次循环结束后，专用分支再次：

1. 检查规划存在；
2. 再解析一次 `DocumentSpec`；
3. 再调用一次 `validateDocumentSpec()`；
4. 未通过则整个格式失败；
5. 通过后调用 `generateDocumentImageAssets()`。

`generateDocumentImageAssets()`：

| 顺序 | 功能 |
|---:|---|
| 1 | 根据正文 visual block 的出现顺序排列 visualRequests |
| 2 | 对尚未被引用的 visualRequests 追加到队尾 |
| 3 | 串行遍历每一张图片 |
| 4 | 为每张图片构造新的 GPT Image 提示 |
| 5 | 调用 `generateResearchImage()` |
| 6 | 用 Sharp 读取尺寸 |
| 7 | 宽小于 640 或高小于 360 时抛错 |
| 8 | 图片转为 Base64 存入 `FinalImageAsset[]` |
| 9 | 任意一张图片失败会终止该 DOCX 格式 |

图片不是并行生成，也没有单张图片重试。

### 9.7 从 DocumentSpec 到 Markdown，再到 WordSpec

图片成功以后：

1. `documentSpecToMarkdown()` 把标题、摘要、关键词、章节、列表、表格和参考文献重新转换成 Markdown；
2. 原始 `DocumentSpec` 和 `imageAssets` 同时放进 metadata；
3. Markdown 作为 `content` 传给 `createExport()`；
4. DOCX 渲染器优先尝试从 metadata 读取结构化 DocumentSpec；
5. 同时仍保留 Markdown/旧 Word Pipeline 兼容路径。

因此当前并不是单一的：

```text
DocumentSpec → DOCX
```

而是：

```text
DocumentSpec
├─→ Markdown content
└─→ metadata.documentSpec
          ↓
createExport → DOCX renderer → WordDocumentSpec
```

## 10. 分支 C：普通聊天后自动导出

如果没有命中上一轮直接导出和专用文件模式，系统先正常生成聊天回答。

| 阶段 | 功能 |
|---|---|
| `streamModel()` | 调用模型并把文字实时发送给界面 |
| 模型不可用 | 在满足条件时切换 economy 模型重试 |
| 长文分段 | 某些长文请求按预设片段多次调用模型并拼接 |
| `incomplete` | 自动续写一次 |
| 句子截断 | `looksAbruptlyTruncated()` 最多继续若干次 |
| 文件格式非空 | 把完整 `assistantText` 传给 `createExport()` |

该路径的文件内容就是聊天正文。它不生成 `DocumentSpec`。

## 11. `createExport()` 的统一底层链

`lib/export/service.ts:170` 被三条聊天文件路径调用。

| 顺序 | 函数 | 功能 |
|---:|---|---|
| 1 | `prepareExportPayload()` | 清洗标题和基础内容 |
| 2 | `buildExportFilename()` | 标题＋时间戳＋扩展名 |
| 3 | `normalizeArtifactContent()` | 按格式提取/规范内容 |
| 4 | `sanitizeExportContent()` | 删除提示词、围栏、重复标题和引导语 |
| 5 | `separateArtifactChannels()` | 把正文和旧 visual specs 分离 |
| 6 | `prepareArtifactContentForExport()` | 完整性检查，并可能执行程序级补救 |
| 7 | blocked | 抛出 422 `ExportError` |
| 8 | 再次 `sanitizeExportContent()` | 对修复后内容再清洗 |
| 9 | 再次 `separateArtifactChannels()` | 再拆正文和视觉元数据 |
| 10 | 合并 metadata | 合并调用方 metadata 和两轮 visual specs |
| 11 | `generateQualityCheckedBuffer()` | 生成二进制并执行质量检查 |
| 12 | `saveExport()` | 保存文件和元数据 |
| 13 | 返回 | filename 和 `/api/download/{id}` |

## 12. `prepareArtifactContentForExport()` 仍有程序级“修复”

这个修复不同于模型四次重写：

- 检查未完成结尾；
- 检查要求篇幅；
- 检查长文最低长度；
- 检查摘要、关键词、引言、结论、参考文献；
- 检查来源说明；
- 某些可修复问题会调用 `repairAcademicContent()` 添加兜底内容；
- 阻塞问题则拒绝生成文件。

所以即使模型 DocumentSpec 通过，转换后的 Markdown 仍可能被第二套完整性逻辑修改。

## 13. DOCX 渲染链

| 顺序 | 文件与函数 | 作用 |
|---:|---|---|
| 1 | `generate-buffer.ts` | 根据格式分发到 DOCX/XLSX/PDF/PPTX 等生成器 |
| 2 | `generateDocxBuffer()` | 选择调色板和模板，读取 metadata |
| 3 | 尝试读取 `metadata.documentSpec` | 结构化 DOCX 路径 |
| 4 | `buildWordDocumentSpec()` | 从 Markdown 构造旧 Word 中间对象 |
| 5 | `applyMatureTableMetadata()` | 如果有 DocumentSpec，用其表格等覆盖部分旧解析结果 |
| 6 | `finalImageAssets()` | 从 metadata 解析 Base64 图片资产 |
| 7 | `buildDocxChildren()` | 生成 Word 段落、标题、表格、图片、图题和参考文献 |
| 8 | `Document` | 配置 Word styles、页边距和 section |
| 9 | `Packer.toBuffer()` | 打包成 DOCX Buffer |

### 13.1 `buildWordDocumentSpec()`

这个兼容层仍会：

- 从 Markdown 猜标题；
- 识别摘要和关键词行；
- 识别章节标题；
- 推断文档类型；
- 解析列表、表格、代码块和 callout；
- 收集参考文献；
- 对 SCI 模板调用 `ensureSciReviewShape()`；
- 必要时补默认标题、摘要、关键词或章节结构。

这意味着模型已经生成的结构还会在渲染前被另一套启发式规则解释。

### 13.2 图片插入

DOCX 生成器：

1. 将 Base64 转成图片 Buffer；
2. 根据 visual block/占位 callout 消费对应图片；
3. 创建 `ImageRun`；
4. 按比例设置尺寸；
5. 在图片下创建图题；
6. 章节结束后可能追加未消费图片；
7. 如果没有最终图片资产，仍可能把旧 visual spec 渲染成 SVG/PNG 结构图。

因此系统同时支持：

- 新 `FinalImageAsset`；
- 旧 `visualSpecs`；
- 文本中的 figure placeholder/callout。

## 14. 文件质量检查、存储与下载

### 14.1 质量检查

`lib/export/quality.ts`：

- 检查文件签名；
- 解压 Office 文件；
- 提取 DOCX/PPTX/XLSX XML 文本；
- 检查内容为空；
- 检查明显乱码；
- 检查文件格式是否与扩展名一致；
- 发现问题时抛出 `ExportError`。

它不检查 Word 的实际分页、图片是否变形、图题是否跨页，也没有渲染页面截图。

### 14.2 存储

`lib/export/store.ts:93`：

1. 生成 export ID；
2. 优先把二进制和元数据上传到 Supabase Storage；
3. 云存储失败时使用本机临时目录兜底；
4. 返回包含 ID、用户、文件名、MIME 和存储位置的记录。

### 14.3 下载

`app/api/download/[id]/route.ts:24`：

1. 验证登录；
2. 读取动态路由 ID；
3. `getExportForUser()` 确保记录属于当前用户；
4. `readExportBuffer()` 从云端或本地读取；
5. 设置 Content-Type 和 Content-Disposition；
6. 返回文件字节。

## 15. 独立 `/api/export` 路径

`app/api/export/route.ts` 不调用 `/api/chat` 的专用文档流程。它自己执行：

1. 登录验证；
2. 请求体解析；
3. 标题和内容清洗；
4. visual specs 分离；
5. 完整性检查；
6. 生成 Buffer；
7. 质量检查；
8. 存储；
9. 返回下载链接。

客户端 `lib/export/client.ts` 调用该接口，并使用 `lib/export/download.ts` 触发浏览器下载。

## 16. 日志链

文件请求识别出格式后创建 `DocumentGenerationTrace`。

| 日志阶段 | 记录内容 |
|---|---|
| `document_job` | 任务开始、完成或失败 |
| `tool_execution` | 工具计划、耗时和阻塞状态 |
| `pipeline_selection` | 实际选中三条旧路径中的哪一条 |
| `template_resolution` | 文档模板和版本 |
| `document_planning` | 规划模型、组件数和视觉预算 |
| `content_generation` | 格式、模型、尝试次数和是否全文重写 |
| `content_validation` | 结构问题、是否 incomplete |
| `document_validation` | 最终结构校验 |
| `figure_generation` | 每张图片、尺寸、模型和耗时 |
| `artifact_render_and_store` | 渲染、文件名和 artifact ID |

日志写入数据库失败时会：

- 输出结构化服务器日志；
- 只警告一次；
- 不阻止文件生成；
- 终态最多等待 1.5 秒刷新日志。

当前生产数据库尚未执行迁移，因此持久化表不可用，服务器结构化日志仍可用。

## 17. 当前所有重试与补救机制

| 位置 | 触发条件 | 次数 | 修复范围 |
|---|---|---:|---|
| Intent Router | 模型失败或输出无效 | 退回本地规则 | 整个意图 |
| 主聊天模型 | 模型额度/权限/可恢复错误 | 1 次 economy | 整个回答 |
| 普通长文 | 预判长文 | 多段 | 分段生成后拼接 |
| 普通回答 | 模型 `incomplete` | 1 次 | 续写 |
| 普通回答 | 句子明显截断 | 受 `MAX_AUTO_CONTINUATIONS` 限制 | 续写 |
| 非结构化文件 | 内容不完整 | 最多 4 次 | 续写或修复 |
| 结构化 DOCX | JSON/结构/内容校验失败或 incomplete | 最多 4 次 | 每次重写完整 DocumentSpec |
| `createExport` | 完整性检查可修复 | 1 次程序修复 | 添加或修复 Markdown 内容 |
| 模型不可用 | 特定错误 | economy 回退 | 重新生成 |
| Storage | 云存储失败 | 本地兜底 | 只改变存储位置 |
| 日志存储 | 数据库失败 | 不重试主任务 | 输出服务器日志 |

## 18. 最容易产生逻辑冲突的重叠职责

| 同一问题 | 当前负责模块 |
|---|---|
| 判断是否生成文件 | Intent Router、旧 Task Router、格式推断、专用模式判断 |
| 判断是否承接上一轮 | ContextBundle、Intent Router fast path、`shouldUsePreviousAssistantAsSource` |
| 选择模板 | `selectExportTemplateId`、`resolveDocumentTemplate`、DOCX palette |
| 判断语言 | Intent Router、`resolveDocumentLanguage`、DocumentPlan、DocumentSpec |
| 判断标题 | 模型、`createArtifactExportTitle`、`prepareExportPayload`、`buildWordDocumentSpec` |
| 判断完整性 | `validateDocumentSpec`、`inspectArtifactContentCompleteness`、Word Pipeline |
| 表格结构 | DocumentSpec、Markdown 表格、WordSpec 覆盖逻辑 |
| 图片 | visualRequests、FinalImageAsset、visualSpecs、placeholder callout |
| SCI 结构 | DocumentTemplate、DocumentPlan、DocumentSpec 校验、`ensureSciReviewShape` |
| 错误恢复 | 模型全文重写、模型续写、程序 Markdown 修复、渲染兼容兜底 |

## 19. 修改代码前必须先回答的路径问题

任何文档 Bug 都应先用任务日志确认：

1. `pipeline_selection` 是哪条路径？
2. 内容源是当前请求、上一轮回答还是普通聊天正文？
3. 是否创建了 `DocumentPlan`？
4. 是否解析出 `DocumentSpec`？
5. 第几次 `content_generation` 失败？
6. `content_validation` 的具体 issue 是什么？
7. 是否进入 `figure_generation`？
8. 是否进入 `artifact_render_and_store`？
9. 渲染使用的是 FinalImageAsset、visualSpecs 还是 placeholder？
10. 失败发生在模型、校验、图片、渲染、质量检查、存储还是下载？

没有先确认这十项，就直接修改关键词、提示词或 DOCX 代码，很容易修错分支。

## 20. 本次逐行覆盖范围

逐行表覆盖以下 64 个文件，不包含与文档生成无调用关系的文献管理页面、Chrome 扩展和翻译专用流程：

| 分组 | 文件 |
|---|---|
| 前端入口 | `components/chat-input.tsx`、`components/chat-shell.tsx` |
| 客户端协议 | `lib/chat/client.ts`、`lib/chat/stream-protocol.ts`、`lib/chat/message-normalize.ts` |
| 附件 | `app/api/chat/attachments/route.ts`、`lib/chat/server/prepare-messages.ts`、`lib/chat/server/attachments.ts`、`lib/documents/parser.ts`、`lib/documents/types.ts`、`lib/documents/constants.ts`、`lib/documents/truncate.ts`、`lib/documents/formats/pdf.ts`、`lib/images/image.ts` |
| 上传存储 | `lib/uploads/storage-client.ts`、`lib/uploads/storage-server.ts`、`lib/uploads/types.ts`、`lib/uploads/constants.ts`、`lib/uploads/storage-constants.ts` |
| 上下文和路由 | `lib/chat/context-bundle.ts`、`lib/chat/intent-router.ts`、`lib/chat/task-router.ts`、`lib/chat/context-budget.ts` |
| 工具 | `lib/chat/tool-planner.ts`、`lib/chat/tool-executor.ts`、`lib/chat/tool-registry.ts`、`lib/chat/visual-policy.ts` |
| 聊天提示与工作区 | `lib/chat/export-guidance.ts`、`lib/chat/model-identity.ts`、`lib/chat/response-style.ts`、`lib/chat/workspace.ts` |
| 服务端上下文 | `lib/chat/server/errors.ts`、`lib/chat/server/library-context.ts` |
| AI | `lib/ai/types.ts`、`lib/ai/errors.ts`、`lib/ai/chat-models.ts`、`lib/ai/openai.ts`、`lib/ai/provider.ts`、`lib/ai/image-generation.ts`、`lib/ai/usage-ledger.ts` |
| 聊天主入口 | `app/api/chat/route.ts` |
| 文档协议 | `lib/export/types.ts`、`lib/export/errors.ts`、`lib/export/document-language.ts`、`lib/export/document-templates.ts`、`lib/export/document-spec.ts` |
| 内容检查 | `lib/export/completeness.ts`、`lib/export/content-sanitize.ts`、`lib/export/artifact-boundary.ts` |
| 导出服务 | `lib/export/service.ts`、`lib/export/generators/generate-buffer.ts` |
| Word | `lib/export/generators/docx.ts`、`lib/export/word-pipeline.ts`、`lib/export/markdown-blocks.ts` |
| 质量和存储 | `lib/export/quality.ts`、`lib/export/store.ts`、`lib/export/filename.ts` |
| 日志 | `lib/export/document-trace.ts`、`app/api/document-jobs/[id]/route.ts` |
| 下载 | `app/api/download/[id]/route.ts` |
| 独立导出 | `app/api/export/route.ts`、`lib/export/client.ts`、`lib/export/download.ts` |
| 基础设施 | `lib/supabase/server.ts`、`lib/uploads/storage-constants.ts` |

逐行表中包括空行、括号和类型行。此类行的作用会标记为结构分隔、作用域结束或数据契约；业务语义以“所在符号”和本文件中的顺序审计为准。
