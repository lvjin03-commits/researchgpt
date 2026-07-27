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
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "researchgpt-word-visual-"));
  const outputPath = path.join(outputDirectory, "word-visual-verification.docx");
  fs.writeFileSync(outputPath, legacyBuffer);
  console.log(`Verified embedded Word image: ${outputPath}`);
}

void main();
