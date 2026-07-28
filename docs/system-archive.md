# ResearchGPT 系统主线归档
本文档用于把现有功能、代码模块和后续开发任务归档到固定系统主线中。以后新增或修改功能时，先确认归属主线，再决定实现位置，避免继续形成重复逻辑和临时补丁。

## 0. 总原则

ResearchGPT 的产品形态不是“很多独立页面”，而是一个科研 Agent 工作台：

用户输入任务 -> 项目与资料范围确认 -> 意图识别 -> 工具规划 -> 工具执行 -> 结果整合 -> 质量检查 -> 保存或导出。

开发原则：

- 聊天框是总入口，页面按钮是快捷入口。
- 同一能力只能有一套核心服务层。
- 页面组件不直接复制业务逻辑，只调用对应系统服务。
- 每次修改必须说明归属主线、影响范围和验证路径。
- 不用临时提示词代替真实工具和文件管线。

## 1. 项目与上下文系统

负责：用户当前在做什么项目，AI 默认读取哪些资料，任务结果归属到哪里。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 新建项目、选择项目、最近项目 | `components/chat-shell.tsx`, `lib/chat/workspace.ts` | 项目入口与当前上下文 |
| 项目云端同步 | `lib/chat/workspace-cloud-sync.ts`, `lib/chat/cloud-sync.ts`, `supabase/migrations/011_research_workspace.sql` | 项目状态持久化 |
| 项目绑定本地文件夹 | `components/desktop-folder-bind-button.tsx`, `lib/desktop/connection.ts` | 项目资料来源 |
| 项目资料面板 | `components/research-tool-panel.tsx` | 当前项目资料展示与文件选择 |
| 临时问题 / 当前项目判断 | `lib/chat/intent-router.ts`, `lib/chat/task-router.ts` | 防止无关问题污染项目 |

需要收束：

- 所有工具调用必须显式携带 `projectId`、`selectedFiles`、`folderScope`。
- 当前项目默认只读项目绑定资料。
- 用户勾选文件后，下一次分析优先只读勾选文件。
- 临时问题默认不写入项目任务上下文，但保留“加入当前项目”的用户选项。
- 项目删除、重命名、恢复上次工作必须稳定。

风险点：

- 如果工具只靠聊天历史推断资料范围，容易读错项目或读错文件。
- 项目资料和文献库资料混用时，必须区分“资料存放位置”和“AI 可读取范围”。

## 2. 文献资料系统

负责：文献获取、保存、分类、追踪和文献元数据管理。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 文献搜索 | `app/literature/page.tsx`, `components/literature-shell.tsx`, `app/api/literature/*` | 搜索与追踪入口 |
| 文献 provider | `lib/literature/providers/*` | OpenAlex、arXiv、PubMed、Crossref 等来源 |
| 搜索排序与关键词 | `lib/literature/ranking/*`, `lib/literature/search-keywords.ts`, `components/literature-keyword-highlight.tsx` | 搜索质量和命中展示 |
| 文献库 | `app/literature/library/page.tsx`, `components/literature-library-shell.tsx` | 文献保存与管理 |
| 文献文件夹 | `lib/literature/server/folder-*`, `supabase/migrations/005_*`, `007_*` | 文献分类 |
| Google Scholar 插件 | `extensions/google-scholar/*`, `app/api/extension/*`, `docs/EXTENSION.md` | 外部保存入口 |
| 文献 PDF 入库 | `app/api/literature/papers/upload/route.ts`, `app/api/literature/library/upload/route.ts`, `lib/literature/server/pdf-archive.ts` | PDF 保存与全文读取前置 |
| 引用关系 | `lib/literature/server/citation-network-*`, `app/api/literature/papers/[id]/citation-network/route.ts` | 引用与被引追踪 |

需要收束：

- 文献状态统一分为：链接已保存、PDF 已保存、全文可读、图表已提取。
- 文献库负责资料管理，不直接负责生成成果。
- 文献删除、移动、拖拽分类必须只走一套服务。
- 搜索结果的来源、期刊、年份、摘要、关键词命中要统一展示。

风险点：

- Google Scholar 插件保存 PDF 与网页上传 PDF 不能形成两套入库逻辑。
- 搜索 provider 不能在 UI 或 route 中散落直接 fetch。

## 3. 本机连接器系统

负责：网页安全读取用户电脑上的本地文件。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 本机连接器实体 | `desktop/main.cjs`, `desktop/preload.cjs` | 本地文件通道 |
| 安装包构建 | `electron-builder.local.json`, `package.json` scripts | 本机连接器交付 |
| 连接状态 | `components/desktop-connection-status.tsx`, `lib/desktop/connection.ts` | 本机能力可用性 |
| 本机连接器页面 | `app/local-connector/page.tsx`, `docs/DESKTOP_CONNECTION.md` | 安装与授权说明 |
| 打开本地文件 / 读取本地文件 | `desktop/main.cjs`, `components/research-tool-panel.tsx` | 本机文件操作 |

需要收束：

- 用户不应该感知“桌面端产品”，统一叫“本机连接器”。
- 绑定本地文件夹时，如果连接器未安装，提示下载安装；如果已安装未授权，提示授权。
- 文件夹变化后需要同步刷新。
- 读取失败提示必须给出具体原因。

风险点：

- 连接器弹出窗口会破坏网页一体感。
- 本地文件读取权限必须由用户授权，不得偷偷扩大范围。

## 4. 文件读取与解析系统

负责：把 PDF、Word、Excel、PPT、图片转成 AI 可理解的文本、表格、图片证据和元数据。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 上传附件解析 | `lib/documents/*`, `lib/uploads/*`, `app/api/chat/attachments/route.ts` | 聊天附件读取 |
| PDF 解析 | `lib/documents/formats/pdf.ts`, `lib/literature/server/parse.ts` | PDF 文本提取 |
| 文献 PDF 全文 | `lib/literature/server/pdf-archive.ts`, `supabase/migrations/008_literature_pdf_archive.sql` | 文献全文缓存 |
| 图表提取 | `lib/literature/server/figure-*`, `supabase/migrations/009_literature_figure_evidence.sql` | 文献图表证据 |
| 本地文件读取测试 | `components/research-tool-panel.tsx`, `desktop/main.cjs` | 可读性检测 |

需要收束：

- 所有文件都要先经过“可读性检测”，再进入 AI 分析。
- 可读状态统一显示：可读取、不可读取、需要转换、需要 OCR。
- `.doc` 明确提示转 `.docx`，不要显示泛化错误。
- 解析结果应缓存，避免重复消耗 token。

风险点：

- AI 不能直接猜文件内容。
- 解析失败却继续分析，会产生幻觉或错误结果。

## 5. AI 调度与任务路由系统

负责：理解用户自然语言，判断任务类型，选择模型和工具。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 意图识别 | `lib/chat/intent-router.ts` | 判断用户想做什么 |
| 任务路由 | `lib/chat/task-router.ts` | 聊天任务分类 |
| 工具注册 | `lib/chat/tool-registry.ts` | 可调用工具清单 |
| 工具规划 | `lib/chat/tool-planner.ts` | 生成执行计划 |
| 工具执行 | `lib/chat/tool-executor.ts` | 调用真实工具 |
| 消息准备 | `lib/chat/server/prepare-messages.ts`, `lib/chat/context-budget.ts` | 上下文与 token 控制 |
| 回答风格 | `lib/chat/response-style.ts`, `lib/chat/visual-policy.ts` | 输出结构与视觉策略 |
| 模型身份 | `lib/chat/model-identity.ts`, `lib/ai/chat-models.ts` | 模型档位与展示 |

需要收束：

- 意图识别优先用轻量大模型理解语义，规则只做安全兜底。
- 执行计划默认折叠，不抢正文注意力。
- 用户说“刚才内容”“这些文件”“这个项目”时，必须从上下文解析引用对象。
- 工具失败后要给用户可执行下一步，不只报错。

风险点：

- 只靠关键词会误判。
- 没有明确工具边界会导致聊天回答和工具执行混在一起。

## 6. 科研分析系统

负责：将文献和文件整理为科研人可用的结构化材料。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 单篇精读 | `app/literature/reading/page.tsx`, `components/literature-paper-reading-shell.tsx` | 单篇论文分析 |
| 文献综述/矩阵流程 | `app/literature/review/page.tsx`, `components/literature-review-shell.tsx` | 批量文献分析 |
| 分析引擎 | `lib/analysis/*`, `lib/literature/server/analyze-service.ts` | 科研分析服务 |
| 文献矩阵导出 | `lib/literature/server/review-matrix-xlsx.ts` | 结构化表格成果 |
| 汇报大纲与 PPT | `lib/literature/server/review-service.ts`, `lib/literature/server/review-pptx.ts` | 汇报型成果前置 |

需要收束：

- 单篇精读、文献分析、文献矩阵都应该能在项目资料面板直接触发。
- 批量分析最低文献数量、选中文献范围、失败原因必须清晰。
- 分析输出优先是文献矩阵、主题分类、证据链、大纲和引用推荐，不再以“一键完整综述文章”为核心。

风险点：

- 全文分析成本高，必须有进度和失败明细。
- 文献不足不是系统错误，要清楚区分“用户资料不足”和“解析失败”。

## 7. 成果生成系统

负责：生成真实可下载的 Word、Excel、PPT、PDF、图片和图表。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 导出 API | `app/api/export/route.ts`, `lib/export/service.ts` | 文件生成统一入口之一 |
| 文件生成器 | `lib/export/generators/*` | docx、xlsx、svg、png 等生成 |
| 导出清洗 | `lib/export/content-sanitize.ts` | 避免输入污染 |
| 质量检查 | `lib/export/quality.ts` | 基础文件检查 |
| 生成文件菜单 | `components/message-export-menu.tsx`, `components/artifact-generation-dialog.tsx` | 用户触发下载 |
| PPT 生成 | `app/api/presentation/generate/route.ts`, `components/presentation-shell.tsx`, `lib/presentation/templates.ts` | 汇报文件生成 |
| 图片生成 | `lib/ai/image-generation.ts`, `app/api/chat/generated-images/route.ts`, `lib/images/image.ts` | GPT Image 入口 |

需要收束：

- 用户要求生成文件时，不能返回“请复制粘贴”，必须进入真实文件生成管线。
- Excel 必须走：主题判断 -> JSON/CSV -> 生成工作表 -> 分列检查 -> 修复 -> 下载。
- Word/PDF 必须走：结构化正文 -> 文档模板 -> 生成 -> 打开检查。
- PPT 必须走：故事线 -> 页结构 -> 版式 -> 渲染检查 -> 修复。
- 图片生成必须区分“结构图/SVG”和“视觉图片/GPT Image”。

风险点：

- 如果直接把模型回答塞进文件，会出现乱码、无排版、一坨文本、标题污染。
- 不同入口分别导出会造成同一功能质量不一致。

## 8. 学术翻译系统

负责：文档级专业翻译，保留格式并输出翻译后文件。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 学术翻译页面 | `app/translate/page.tsx`, `components/translation-shell.tsx` | 主翻译入口 |
| DOCX 翻译 API | `app/api/translate/docx/route.ts` | 文档翻译服务 |
| 翻译管线 | `lib/translation/*` | 解析、翻译、重建 |
| 项目翻译弹窗 | `components/project-translation-dialog.tsx` | 项目内翻译入口 |

需要收束：

- 学术翻译页面和项目内翻译必须共用同一套翻译管线。
- 输出下载链接，不把翻译全文塞进聊天。
- 支持纯英文和中英双语。
- 模型选择进入翻译设置。

风险点：

- 两套翻译逻辑会导致同一文件在不同入口质量不同。
- 保留格式比普通文本翻译重要。

## 9. 搜索与知识获取系统

负责：获取最新互联网信息和学术资料。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 文献 provider | `lib/literature/providers/*` | 学术数据库 |
| 搜索 debug | `components/literature-debug-panel.tsx`, `lib/literature/search-debug.ts` | 检索质量诊断 |
| 联网模式 | `components/chat-input.tsx`, `app/api/chat/route.ts` | 聊天联网开关 |
| 来源图片/来源展示 | `lib/chat/server/source-images.ts` | 回答来源辅助 |

需要收束：

- 普通 Web Search 与学术搜索分开。
- 最新信息必须调用搜索工具，不靠模型记忆。
- 搜索结果要保留来源、日期、链接、摘要。

风险点：

- API 限流、数据库覆盖不足会导致结果不如 Google Scholar。
- Semantic Scholar 这类需要 key 的 provider 必须有降级策略。

## 10. 成本与模型系统

负责：模型档位、token 统计、成本提示和降本策略。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 模型配置 | `lib/ai/chat-models.ts`, `lib/ai/provider.ts`, `lib/ai/openai.ts` | 模型调用 |
| 成本计算 | `lib/ai/cost.ts`, `lib/ai/usage-ledger.ts` | token 与费用 |
| 用量页面 | `app/usage/page.tsx` | 用户成本可视化 |
| AI 用量数据库 | `supabase/migrations/010_ai_usage_events.sql` | 用量记录 |
| 上下文预算 | `lib/chat/context-budget.ts` | token 控制 |

需要收束：

- 高成本模型调用前提示。
- 简单任务自动走低成本模型。
- 文件解析和文献分析结果缓存。
- 图片生成单独提示额外费用。

风险点：

- 若每次意图识别、全文分析、文件生成都用高价模型，商业模式不可持续。
- 成本提示必须可信，不能只做展示。

## 11. 质量检查系统

负责：检查生成结果能不能真的使用。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 文件质量检查 | `lib/export/quality.ts` | 基础文件可用性 |
| 编码检查 | `scripts/check-encoding.mjs` | 防止源码乱码 |
| 生成器验证 | `scripts/verify-artifact-generators.ts` | 文件生成回归 |
| 文献命令验证 | `scripts/verify-library-commands.mjs` | 文献工具回归 |
| QA 文档 | `docs/qa-checklist.md`, `docs/regression-tests.md` | 手动验证 |

需要收束：

- Word、Excel、PPT、PDF、图片要有各自质量检查器。
- 检查失败后自动修复一次，再交付。
- Excel 必须检查分列是否成功。
- PPT 必须检查文本溢出和页面密度。
- PDF 必须检查乱码和页面裁切。

风险点：

- “生成成功”不等于“用户可用”。
- 不做质量检查会反复出现打不开、乱码、排版差。

## 12. 用户界面与交互系统

负责：让用户觉得所有能力是一个统一工作台。

当前功能：

| 功能 | 现有位置 | 归档说明 |
| --- | --- | --- |
| 聊天界面 | `app/chat/page.tsx`, `components/chat-shell.tsx`, `components/chat-*` | 总入口 |
| 左侧导航 | `components/sidebar.tsx` | 项目、文献、功能入口 |
| 页面头部 | `components/research-page-header.tsx` | 顶部导航 |
| 右侧工作台 | `components/research-tool-panel.tsx` | 当前工具与资料 |
| Toast / 状态提示 | 多个组件内 | 用户反馈 |
| 文献卡片与弹窗 | `components/literature-*` | 文献 UI |
| PPT 模板选择 | `components/presentation-template-picker.tsx` | 成果生成 UI |

需要收束：

- 聊天框保持主入口。
- 右侧工作台随任务动态切换。
- 执行计划默认折叠，不抢正文。
- 文件夹双击打开、右键菜单、拖拽分类要统一交互。
- 所有功能入口加粗显眼，但不能重复堆叠。

风险点：

- 页面入口太多会让用户不知道从哪里开始。
- 同一功能在不同页面展示不同，会削弱一体感。

## 13. 当前重复与临时补丁清单

| 问题 | 涉及主线 | 当前风险 | 整理方向 |
| --- | --- | --- | --- |
| 文件生成既在聊天导出，又在独立导出 API，又在 PPT/翻译流程中出现 | 成果生成、翻译、科研分析 | 质量不一致、输入污染 | 合并到统一 Artifact Pipeline |
| 项目资料、本地文件、文献库文件边界不够清楚 | 项目、本机连接器、文献资料 | AI 读错文件 | 所有工具调用强制带 scope |
| 翻译页面和项目内翻译体验不一致 | 学术翻译 | 质量差异 | 共用 `lib/translation` 管线 |
| 图片生成与 SVG 结构图混用 | 成果生成、AI 调度 | 用户要图片却只得到网页卡片 | 区分 GPT Image 与结构化图表工具 |
| 执行计划展示过重 | AI 调度、UI | 干扰正文 | 折叠为低优先级辅助信息 |
| 连接器像桌面端产品暴露给用户 | 本机连接器、UI | 一体感差 | 改为后台本机能力通道 |
| Excel 生成可退化为一坨文本 | 成果生成、质量检查 | 文件不可用 | 强制结构化 JSON/CSV 和分列检查 |
| 文档生成把模型说明塞入正文 | 成果生成 | 标题污染、排版差 | 统一清洗和结构化生成 |

## 14. 推荐重构顺序

### 第一阶段：收束上下文和资料范围

目标：解决 AI 读错文件、项目混乱、资料范围不清。

交付：

- 工具调用统一携带 `projectId`、`selectedFiles`、`folderScope`。
- 项目资料面板清楚显示当前可读资料。
- 选中文件优先级固定。
- 临时问题不污染项目。

### 第二阶段：统一文件生成管线

目标：解决 Word、Excel、PPT、PDF、图片生成质量不稳定。

交付：

- 建立 `Artifact Pipeline`。
- 所有入口都调用同一套文件生成服务。
- Excel 先落地结构化生成与分列检查。
- Word/PDF 防输入污染和乱码。

### 第三阶段：统一文件读取与解析

目标：确保 AI 分析前真的能读到内容。

交付：

- 可读性检测统一。
- PDF、DOCX、XLSX、PPTX、图片状态统一展示。
- 解析结果缓存。
- 失败原因可解释。

### 第四阶段：统一项目内科研工具

目标：单篇精读、文献分析、文献矩阵、翻译都能在项目里完成。

交付：

- 项目资料面板工具按钮统一。
- 单篇工具和批量工具边界清楚。
- 分析结果可导出。

### 第五阶段：质量检查闭环

目标：从“能生成”升级到“可交付”。

交付：

- 文件可打开检查。
- Excel 分列检查。
- PPT 溢出检查。
- PDF 乱码检查。
- 失败自动修复一次。

## 15. 开发前检查模板

每个新需求先填写：

```text
需求：
归属主线：
是否已有类似逻辑：
是否需要新工具：
是否影响项目资料范围：
是否影响文件生成：
是否影响成本：
核心服务层：
页面入口：
验证路径：
```

如果填不清楚，不进入编码。
