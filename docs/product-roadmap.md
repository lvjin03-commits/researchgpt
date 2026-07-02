# ResearchGPT 产品路线图

本文件为 ResearchGPT 官方产品路线图，描述各阶段功能规划与当前交付状态。

---

## Phase 1（当前）

已交付的核心研究助手能力：

- **AI Chat** — 多轮对话、附件上传、对话历史与导出
- **Document Translation** — Word 文档（.docx）翻译
- **Literature Tracker** — 按学科与来源追踪论文，AI 相关度评分与 triage
- **Literature Library** — 按阅读状态与文件夹组织已追踪论文
- **Paper Detail** — 论文详情研究工作区：AI 分析、阅读指南、研究价值、个人笔记与引用导出

---

## Phase 2

扩展研究情报与跟踪能力：

- **Research Feed** — 个性化研究动态流，聚合新论文与领域更新
- **Author Tracker** — 关注作者，追踪其最新发表与研究方向变化
- **Laboratory Tracker** — 关注实验室 / 研究组，追踪团队产出与项目进展

---

## Phase 3

深化论文关联与阅读辅助：

- **Citation Network** — 引文关系可视化，探索引用与被引用网络
- **Related Papers** — 基于主题、方法与引文的相关论文推荐
- **AI Reading Assistant** — 交互式阅读助手，支持段落级问答与重点提炼

---

## Phase 4

面向系统性研究与分析：

- **AI Literature Review** — 自动生成结构化文献综述与对比分析
- **PDF Deep Analysis** — 全文 PDF 深度解析（图表、公式、实验细节）
- **Research Dashboard** — 跨模块研究仪表盘，汇总阅读进度、领域趋势与个人产出

---

## 说明

- Phase 1 功能已在当前代码库中实现或部分实现（如 Paper Detail 中的「引文网络」「相关论文」为 Phase 3 占位）。
- 路线图按阶段递进，后续阶段依赖 Phase 1 的文献数据与用户工作区基础。
- API 路由、数据库 schema 与源代码命名保持英文；面向用户的 UI 文案遵循 [`glossary.md`](./glossary.md)。
