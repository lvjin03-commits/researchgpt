const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const swc = require("next/dist/build/swc");

const projectRoot = path.resolve(__dirname, "..");
const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveResearchGptAlias(request, parent, isMain, options) {
  const resolvedRequest = request.startsWith("@/")
    ? path.join(projectRoot, request.slice(2))
    : request;
  return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = swc.transformSync(source, {
    filename,
    jsc: {
      parser: { syntax: "typescript" },
      target: "es2022",
    },
    module: { type: "commonjs" },
  });
  module._compile(output.code, filename);
};

const JSZip = require("jszip");
const {
  separateArtifactChannels,
} = require("../lib/export/artifact-boundary.ts");
const { generateDocxBuffer } = require("../lib/export/generators/docx.ts");
const {
  createDocumentPlan,
  documentSpecToMarkdown,
  parseDocumentSpec,
  validateDocumentSpec,
} = require("../lib/export/document-spec.ts");
const {
  DOCUMENT_TEMPLATE_REGISTRY,
  resolveDocumentTemplate,
} = require("../lib/export/document-templates.ts");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyScenario(name, content) {
  const channels = separateArtifactChannels("docx", content);
  assert(
    channels.visualSpecs.length === 1,
    `${name}: expected one visual spec, got ${channels.visualSpecs.length}; content=${channels.content}`,
  );

  const buffer = await generateDocxBuffer(
    "多时间尺度动态网络研究",
    channels.content,
    "academic",
    { visualSpecs: channels.visualSpecs },
  );
  const archive = await JSZip.loadAsync(buffer);
  const documentXml = await archive.file("word/document.xml").async("string");
  const mediaFiles = Object.keys(archive.files).filter((entry) =>
    /^word\/media\/.+\.png$/i.test(entry),
  );

  assert(mediaFiles.length === 1, `${name}: expected one embedded PNG`);
  assert(!/占位符|evidenceType|aistructure/i.test(documentXml), `${name}: leaked internal visual text`);

  return buffer;
}

async function documentText(buffer) {
  const archive = await JSZip.loadAsync(buffer);
  return archive.file("word/document.xml").async("string");
}

async function verifyDocumentLanguage() {
  const chineseContent = `## 摘要

物理凝胶由非共价相互作用形成，制备路径会显著影响网络结构与材料性能。

关键词：物理凝胶；非共价作用；结构性能关系

## 2. 制备路径

温度诱导、溶剂交换和冻融循环是常见制备方法。

| 方法 | 特点 |
|---|---|
| 冻融法 | 无需化学交联剂 |

## 4. 结论与展望

未来需要建立可预测的组装与制造方法。

## 参考文献

[1] 当前未提供可核验参考文献。`;
  const chineseBuffer = await generateDocxBuffer(
    "Abstract",
    chineseContent,
    "nature",
    { documentLanguage: "zh-CN", requestQuery: "生成一篇中文物理凝胶综述" },
  );
  const chineseXml = await documentText(chineseBuffer);
  for (const expected of ["ResearchGPT 生成文档", "摘要", "关键词：", "1. 引言", "表 1.", "参考文献"]) {
    assert(chineseXml.includes(expected), `Chinese document is missing ${expected}`);
  }
  for (const forbidden of [
    "This section introduces",
    ">Abstract<",
    "Keywords:",
    "Table 1.",
    ">References<",
    ">1. Introduction<",
  ]) {
    assert(!chineseXml.includes(forbidden), `Chinese document leaked ${forbidden}`);
  }

  const englishContent = `## Abstract

Physical gels form through reversible non-covalent interactions.

Keywords: physical gels; self-assembly

## 1. Introduction

Preparation history controls network structure and performance.

## References

[1] No verified source was provided.`;
  const englishBuffer = await generateDocxBuffer(
    "Physical Gel Preparation",
    englishContent,
    "nature",
    { documentLanguage: "en-US", requestQuery: "Write an English review" },
  );
  const englishXml = await documentText(englishBuffer);
  for (const expected of ["Physical Gel Preparation", "Abstract", "Keywords:", "1. Introduction", "References"]) {
    assert(englishXml.includes(expected), `English document is missing ${expected}`);
  }
  assert(!/[摘要关键词引言参考文献]/.test(englishXml), "English document leaked Chinese labels");

  return chineseBuffer;
}

async function verifyStructuredDocumentPipeline() {
  const sciTemplate = resolveDocumentTemplate({
    query: "Generate an SCI review manuscript as a Word document with an abstract and references.",
    format: "docx",
    legacyTemplateId: "academic",
  });
  assert(sciTemplate.id === "sci-academic-word", "SCI template was not selected before planning");
  assert(sciTemplate.version === 1, "SCI template version was not frozen");
  assert(
    DOCUMENT_TEMPLATE_REGISTRY.filter((template) => template.status === "active").length === 1,
    "Only the SCI template should be active in the initial registry",
  );
  const unmatchedTemplate = resolveDocumentTemplate({
    query: "Create meeting notes as a Word document.",
    format: "docx",
    legacyTemplateId: "academic",
  });
  assert(
    unmatchedTemplate.source === "legacy_fallback",
    "Planned templates must not be selected automatically",
  );
  const basePlan = createDocumentPlan({
    query: "用中文生成一篇关于物理凝胶制备的 Word 综述，包含一张机制图",
    template: sciTemplate,
    maxVisuals: 2,
  });
  assert(basePlan.templateId === "sci-academic-word", "Plan lost the selected template");
  assert(
    basePlan.componentTasks.some((component) => component.id === "abstract" && component.required),
    "SCI component contract did not reach the plan",
  );
  const componentOrder = Object.fromEntries(
    basePlan.componentTasks.map((component) => [
      component.id,
      component.executionOrder,
    ]),
  );
  assert(
    componentOrder.body < componentOrder.conclusion &&
      componentOrder.conclusion < componentOrder.abstract &&
      componentOrder.abstract < componentOrder.title,
    "SCI component dependencies were not converted into a deterministic execution order",
  );
  const plan = {
    ...basePlan,
    sections: [
      {
        id: "section-1",
        role: "introduction",
        headingIntent: "介绍物理凝胶的制备与组装机制",
        requiredPoints: ["多尺度组装", "主要制备路径"],
      },
    ],
    visualIntents: [
      {
        id: "visual-1",
        sectionId: "section-1",
        purpose: "解释多尺度组装机制",
        preferredType: "mechanism",
      },
    ],
  };
  const source = JSON.stringify({
    version: 1,
    templateId: "sci-academic-word",
    templateVersion: 1,
    language: "zh-CN",
    documentType: "review",
    title: "物理凝胶制备的组装机制与工艺调控",
    abstract:
      "物理凝胶依靠可逆非共价作用形成网络，其制备历史会影响网络均一性、力学稳定性与刺激响应行为。本文总结温度诱导、溶剂交换和冻融循环等主要路径，并讨论制备参数与结构性能之间的联系。",
    keywords: ["物理凝胶", "非共价作用", "组装机制"],
    sections: [
      {
        id: "section-1",
        heading: "1. 引言",
        level: 1,
        blocks: [
          {
            id: "block-1",
            type: "paragraph",
            text: "物理凝胶的形成不是单一步骤，而是由分子缔合、局域聚集和网络贯通共同构成的多尺度过程。",
          },
          {
            id: "block-2",
            type: "table",
            caption: "主要制备路径比较",
            columns: ["制备路径", "主要特点"],
            rows: [
              ["温度诱导", "通过构象变化或结晶域形成网络"],
              ["冻融循环", "利用浓缩效应和物理结晶点增强网络"],
            ],
            source: "作者根据正文内容整理",
          },
          {
            id: "block-3",
            type: "visual",
            visualRequestId: "visual-1",
          },
        ],
      },
    ],
    references: [
      {
        id: "reference-1",
        displayText: "当前未提供经过验证的参考文献，正式使用前需要补充。",
        verified: false,
      },
    ],
    visualRequests: [
      {
        id: "visual-1",
        sectionId: "section-1",
        purpose: "解释物理凝胶从分子缔合到网络贯通的形成机制",
        type: "mechanism",
        contentBrief: "展示分子缔合、局域聚集和网络贯通三个连续层级",
        requiredElements: ["分子缔合", "局域聚集", "网络贯通"],
        caption: "物理凝胶的多尺度组装机制",
        sourceStatement: "ResearchGPT 根据成熟正文生成的概念示意图",
        evidenceKind: "conceptual_synthesis",
      },
    ],
  });
  const spec = parseDocumentSpec(`\`\`\`json\n${source}\n\`\`\``);
  assert(spec, "Structured DocumentSpec could not be parsed");
  const validation = validateDocumentSpec(spec, plan);
  assert(validation.passed, `Structured DocumentSpec failed: ${JSON.stringify(validation.issues)}`);
  const templateMismatch = validateDocumentSpec(
    { ...spec, templateVersion: 999 },
    plan,
  );
  assert(
    templateMismatch.issues.some((issue) => issue.code === "template_mismatch"),
    "Template drift was not rejected",
  );

  const sharp = require("sharp");
  const imageBuffer = await sharp({
    create: {
      width: 1200,
      height: 675,
      channels: 4,
      background: { r: 230, g: 242, b: 255, alpha: 1 },
    },
  }).png().toBuffer();
  const markdown = documentSpecToMarkdown(spec);
  const buffer = await generateDocxBuffer(
    spec.title,
    markdown,
    "nature",
    {
      documentLanguage: spec.language,
      requestQuery: "中文物理凝胶综述",
      documentSpec: spec,
      imageAssets: [
        {
          id: "asset-visual-1",
          requestId: "visual-1",
          mimeType: "image/png",
          dataBase64: imageBuffer.toString("base64"),
          width: 1200,
          height: 675,
          caption: "物理凝胶的多尺度组装机制",
          source: "ResearchGPT 根据成熟正文生成的概念示意图",
          altText: "分子缔合、局域聚集和网络贯通",
        },
      ],
    },
  );
  const archive = await JSZip.loadAsync(buffer);
  const xml = await archive.file("word/document.xml").async("string");
  const stylesXml = await archive.file("word/styles.xml").async("string");
  const media = Object.keys(archive.files).filter((entry) => /^word\/media\/.+\.(?:png|jpe?g)$/i.test(entry));
  assert(
    media.length === 1,
    `Final structured document did not embed the mature image asset; entries=${Object.keys(archive.files).join(",")}`,
  );
  assert(xml.includes("物理凝胶制备的组装机制与工艺调控"), "Final title was not rendered");
  assert(xml.includes("主要制备路径比较"), "Mature table caption was not rendered");
  assert(!/visualRequest|evidenceKind|contentBrief|placeholder/i.test(xml), "Internal structured data leaked into final DOCX");
  for (const pageRule of [
    'w:w="11906"',
    'w:h="16838"',
    'w:top="1134"',
    'w:right="1247"',
    'w:bottom="1134"',
    'w:left="1247"',
    'w:header="567"',
    'w:footer="567"',
  ]) {
    assert(xml.includes(pageRule), `SCI fixed page rule is missing: ${pageRule}`);
  }
  for (const styleRule of [
    'w:styleId="Title"',
    'w:styleId="Heading1"',
    'w:styleId="Heading2"',
    'w:styleId="Heading3"',
    'w:styleId="Caption"',
    'w:styleId="Reference"',
    'w:ascii="Arial"',
    'w:ascii="Times New Roman"',
  ]) {
    assert(stylesXml.includes(styleRule), `SCI Word Style rule is missing: ${styleRule}`);
  }
  return buffer;
}

async function main() {
  const tagged = `# 多时间尺度动态网络研究

## 核心机制

系统在加载与卸载阶段表现出不同的耗散路径。

<researchgpt-visual>{"type":"process","title":"多时间尺度动态网络的能量耗散机制","steps":[{"title":"稳定骨架节点","description":"维持网络整体结构"},{"title":"快速交换弱节点","description":"承担可逆连接切换"},{"title":"卸载重缩合","description":"恢复网络并耗散能量"}],"caption":"多时间尺度动态网络中的结构恢复与耗散路径","source":"作者根据文档内容进行的概念性归纳","evidenceType":"ai_structure"}</researchgpt-visual>

## 结论

跨尺度节点协同决定网络的韧性。`;

  const legacy = `# 多时间尺度动态网络研究

## 核心机制

图2 占位符：多时间尺度动态网络的能量耗散机制。图中建议展示稳定骨架节点、快速交换弱节点和可逆聚集微区。

图2 图注：快交换节点提供结构恢复，慢交换节点维持形状。

来源与证据类型：作者概念性归纳；evidenceType=aistructure；该图为机制示意，不是原始力学测试数据。

## 结论

跨尺度节点协同决定网络的韧性。`;

  await verifyScenario("tagged visual channel", tagged);
  const legacyBuffer = await verifyScenario("legacy Chinese placeholder", legacy);
  const chineseBuffer = await verifyDocumentLanguage();
  const structuredBuffer = await verifyStructuredDocumentPipeline();
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "researchgpt-word-visual-"));
  const outputPath = path.join(outputDirectory, "word-visual-verification.docx");
  const languageOutputPath = path.join(outputDirectory, "word-language-verification.docx");
  const structuredOutputPath = path.join(outputDirectory, "word-structured-verification.docx");
  fs.writeFileSync(outputPath, legacyBuffer);
  fs.writeFileSync(languageOutputPath, chineseBuffer);
  fs.writeFileSync(structuredOutputPath, structuredBuffer);
  console.log(`Verified embedded Word image: ${outputPath}`);
  console.log(`Verified document language: ${languageOutputPath}`);
  console.log(`Verified structured document pipeline: ${structuredOutputPath}`);
}

void main();
