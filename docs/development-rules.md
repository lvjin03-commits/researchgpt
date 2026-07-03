# ResearchGPT 开发规则

本文件为 ResearchGPT 贡献与功能开发时必须遵守的规则，目的是防止新功能破坏已有能力。

> 与 [qa-checklist.md](./qa-checklist.md)、[regression-tests.md](./regression-tests.md) 配合使用。

---

## 1. 模块边界

- **新功能不得修改无关模块。** 例如：做文献库筛选时，不要顺手改 chat 路由或翻译服务。
- 变更应限制在与需求直接相关的文件内；跨模块改动需在 PR 中明确说明原因。
- 以下模块除非任务明确要求，否则视为 **禁止顺带修改** 区域：
  - 对话（Chat）与附件
  - 文件上传
  - 文档翻译
  - 文献搜索 provider 管道与去重逻辑
  - 认证与 middleware
  - 数据库 schema / migration（无明确需求时不改）

---

## 2. 构建与质量门槛

- **每个功能必须能通过 `npm run build`。** 合并前运行 `npm run qa`（等同于 build）。
- **每个功能必须包含手动回归检查。** 至少覆盖 [regression-tests.md](./regression-tests.md) 中与改动相关的区块。
- 不要提交已知 broken build 或依赖未定义环境变量的“半成品”。

---

## 3. UI 与文案

- **UI 文案必须遵循 [glossary.md](./glossary.md)。** 新增界面文字前先查术语表。
- **不要新增英文 UI 字符串，** 除非它们是 intentional 保留的专有名词（ResearchGPT、arXiv、PubMed、DOI、PDF 等，见 glossary）。
- API 路由、数据库字段、TypeScript 标识符保持英文；用户可见字符串使用简体中文。

---

## 4. 数据诚实性

- **不要添加假数据。** 无 API 结果时显示空状态或错误，不用 mock 论文填充列表。
- **不要编造：** 被引用次数、影响因子、DOI、参考文献、引用关系。
- 仅在 provider 或外部 API 真实返回时展示对应字段；缺失则省略或显示「暂无」类文案。
- 不要用随机数或 hardcode 占位 metrics 冒充真实文献 metadata。

---

## 5. 用户可见命名

- **不要向用户暴露原始 provider / 数据库名称，** 除非产品设计 intentional（如 arXiv、PubMed badges）。
- 错误信息使用用户友好中文，不暴露 `Supabase`、`OpenAlex API`、`PGRST` 等内部名称。
- 日志与 debug 信息可保留英文技术细节，但仅限服务端或 `DEBUG_*` 开发模式。

---

## 6. API 与数据库

- **不要删除已有 API 而不提供迁移路径。** 废弃路由应有过渡期、文档说明或版本兼容。
- 响应 shape 变更需考虑现有 client 解析逻辑（如 `lib/literature/client.ts` 校验）。
- Schema 变更必须附带 migration 文件，并在部署 checklist 中注明。

---

## 7. Provider 架构

- **Provider 逻辑必须留在统一接口之后。** 新数据源实现 `LiteratureProvider`（`searchPapers` / `getPaper` / `normalizePaper`），不要散落在 UI 或 route 里直接 fetch。
- 搜索顺序、去重、合并规则变更属于 **高影响改动**，需单独任务、单独回归（见 regression D 节）。
- 未实现的 provider 以 disabled placeholder 存在，不接入用户可选来源。

---

## 8. 论文详情与追踪器

- 论文详情页（Paper Detail / Research Workspace）布局与核心区块变更需 **单独评审**。
- 文献追踪 UI 字段变更需同步 glossary 与 QA 清单。
- Citation network 依赖 Semantic Scholar 等第三方限流，必须保留 graceful degradation。

---

## 9. 调试与开发-only 功能

- 开发调试能力（如 `DEBUG_LITERATURE`）必须 **默认关闭**，且不影响生产搜索行为。
- 不要在生产 bundle 中依赖 `NEXT_PUBLIC_*` 暴露敏感调试开关，除非 intentional。

---

## 10. 提交前自检（Quick checklist）

- [ ] 只改了与任务相关的文件
- [ ] `npm run qa` 通过
- [ ] 相关 regression 用例已手动执行
- [ ] 新 UI 文案符合 glossary
- [ ] 无假数据、无编造 metrics
- [ ] 无密钥、无 `.env` 提交

---

## 相关文档

- [术语表](./glossary.md)
- [QA 检查清单](./qa-checklist.md)
- [手动回归测试](./regression-tests.md)
- [产品路线图](./product-roadmap.md)
