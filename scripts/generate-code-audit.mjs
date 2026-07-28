import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const outputDir = path.join(root, "docs", "code-audit");
const excludedDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  "release",
  "release-installer",
  "release-local",
  "release-local-v2",
  "tmp",
  ".tmp",
]);
const includedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".cjs",
  ".mjs",
  ".sql",
  ".json",
  ".css",
  ".md",
]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    if (entry.name === ".env.local" || entry.name === "package-lock.json") continue;
    const absolute = path.join(directory, entry.name);
    if (absolute === outputDir) continue;
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (includedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(absolute);
    }
  }
  return files;
}

function relative(absolute) {
  return path.relative(root, absolute).replaceAll("\\", "/");
}

function csv(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function fileRole(file) {
  if (/^app\/api\/.+\/route\.ts$/.test(file)) return "Next.js API入口";
  if (/^app\/.+\/page\.tsx$/.test(file) || file === "app/page.tsx") return "Next.js页面入口";
  if (file === "app/layout.tsx") return "全局页面布局";
  if (file === "middleware.ts") return "认证与请求中间件";
  if (/^components\//.test(file)) return "React界面组件";
  if (/^lib\/ai\//.test(file)) return "AI模型、成本与用量基础设施";
  if (/^lib\/chat\/server\//.test(file)) return "聊天服务端辅助模块";
  if (/^lib\/chat\//.test(file)) return "聊天路由、上下文、工具与历史";
  if (/^lib\/analysis\//.test(file)) return "上传附件解析与证据注入";
  if (/^lib\/documents\//.test(file)) return "通用文档解析";
  if (/^lib\/export\/generators\//.test(file)) return "文件格式渲染器";
  if (/^lib\/export\//.test(file)) return "文件规划、校验、导出与存储";
  if (/^lib\/literature\/providers\//.test(file)) return "外部文献数据源适配器";
  if (/^lib\/literature\/ranking\//.test(file)) return "文献排序与评分";
  if (/^lib\/literature\/server\//.test(file)) return "文献服务端业务";
  if (/^lib\/literature\//.test(file)) return "文献客户端、类型与领域逻辑";
  if (/^lib\/translation\//.test(file)) return "DOCX翻译流程";
  if (/^lib\/presentation\//.test(file)) return "演示文稿模板";
  if (/^lib\/uploads\//.test(file)) return "上传文件校验与存储";
  if (/^lib\/supabase\//.test(file)) return "Supabase认证与数据库连接";
  if (/^lib\/desktop\//.test(file) || /^desktop\//.test(file)) return "桌面本地连接器";
  if (/^extensions\//.test(file)) return "Chrome扩展";
  if (/^supabase\/migrations\//.test(file)) return "数据库迁移";
  if (/^scripts\//.test(file)) return "开发与回归脚本";
  if (/^docs\//.test(file)) return "设计与维护文档";
  if (file.endsWith(".json") || file.endsWith(".mjs") || file.endsWith(".ts")) {
    return "项目配置";
  }
  return "项目资源";
}

function syntaxKindForFile(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".ts")) return ts.ScriptKind.TS;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.Unknown;
}

function nodeName(node, sourceFile) {
  if (node.name && typeof node.name.getText === "function") {
    return node.name.getText(sourceFile);
  }
  if (ts.isVariableDeclaration(node) && node.name) return node.name.getText(sourceFile);
  if (ts.isExportAssignment(node)) return "default export";
  return "";
}

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return "函数";
  }
  if (ts.isClassDeclaration(node)) return "类";
  if (ts.isInterfaceDeclaration(node)) return "接口";
  if (ts.isTypeAliasDeclaration(node)) return "类型";
  if (ts.isEnumDeclaration(node)) return "枚举";
  if (ts.isMethodDeclaration(node)) return "方法";
  if (ts.isVariableDeclaration(node)) return "变量";
  if (ts.isImportDeclaration(node)) return "导入";
  if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return "导出";
  return "";
}

function symbolDescription(kind, name) {
  if (kind === "函数" || kind === "方法") return `实现 ${name || "匿名逻辑"} 的调用与控制流程`;
  if (kind === "类") return `封装 ${name} 的状态和行为`;
  if (kind === "接口" || kind === "类型" || kind === "枚举") return `定义 ${name} 的数据契约`;
  if (kind === "变量") return `保存或计算 ${name} 所需的数据`;
  if (kind === "导入") return "引入本文件依赖";
  if (kind === "导出") return "向其他模块公开能力";
  return "组成模块实现";
}

function collectSymbols(sourceFile) {
  const symbols = [];
  function visit(node) {
    const kind = declarationKind(node);
    const name = nodeName(node, sourceFile);
    const shouldRecord =
      kind &&
      (kind !== "变量" ||
        (node.initializer &&
          (ts.isArrowFunction(node.initializer) ||
            ts.isFunctionExpression(node.initializer) ||
            ts.isObjectLiteralExpression(node.initializer))));
    if (shouldRecord) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      symbols.push({
        name: name || `${kind}@${start}`,
        kind,
        start,
        end,
        description: symbolDescription(kind, name),
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return symbols;
}

function classifyLine(trimmed, extension) {
  if (!trimmed) return ["空行", "分隔代码结构，提高可读性"];
  if (/^(\/\/|\/\*|\*|<!--|#(?!\s*(?:include|define)))/.test(trimmed)) {
    return ["注释/说明", "记录设计意图、说明或文档内容"];
  }
  if (/^import\b|^const .+require\(/.test(trimmed)) return ["依赖导入", "引入当前模块使用的外部或内部依赖"];
  if (/^export\b/.test(trimmed)) return ["公开接口", "定义或导出供其他模块调用的能力"];
  if (/^(type|interface|enum)\b/.test(trimmed)) return ["数据契约", "定义结构化数据、状态或枚举约束"];
  if (/^(if|else if|else)\b/.test(trimmed)) return ["条件分支", "根据运行条件选择执行路径"];
  if (/^(for|while)\b/.test(trimmed)) return ["循环", "遍历或重复处理集合数据"];
  if (/^switch\b|^case\b|^default:/.test(trimmed)) return ["分支选择", "根据离散类型选择实现"];
  if (/^return\b/.test(trimmed)) return ["返回结果", "结束当前作用域并向调用方返回值"];
  if (/^throw\b/.test(trimmed)) return ["错误终止", "在约束不满足时中止当前流程"];
  if (/^try\b|^catch\b|^finally\b/.test(trimmed)) return ["异常处理", "捕获、转换或清理运行错误"];
  if (/^(await\s+)?fetch\(|\.from\(|\.select\(|\.insert\(|\.update\(|\.delete\(/.test(trimmed)) {
    return ["外部调用/数据访问", "调用网络接口、数据库或外部服务"];
  }
  if (extension === ".sql") {
    return ["数据库定义", "创建、修改或约束数据库对象与权限"];
  }
  if (/^<[A-Za-z]|^return\s*\(|className=|onClick=|useState\(|useEffect\(/.test(trimmed)) {
    return ["界面逻辑", "构建界面、状态或用户交互"];
  }
  if (/^(const|let|var)\b/.test(trimmed)) return ["变量/计算", "声明状态、配置或中间计算结果"];
  if (/^[}\]);,]+$/.test(trimmed)) return ["结构结束", "结束当前语句、对象或作用域"];
  return ["实现语句", "执行当前作用域的具体业务、转换或配置逻辑"];
}

const files = walk(root).sort((a, b) => relative(a).localeCompare(relative(b)));
fs.mkdirSync(outputDir, { recursive: true });

const fileRows = [
  ["文件", "行数", "类别", "扩展名", "符号数", "主要作用"].map(csv).join(","),
];
const symbolRows = [
  ["文件", "起始行", "结束行", "符号", "类型", "作用"].map(csv).join(","),
];
const lineRows = [
  ["文件", "行号", "所在符号", "行类型", "作用", "代码摘要"].map(csv).join(","),
];

let totalLines = 0;
let totalSymbols = 0;

for (const absolute of files) {
  const file = relative(absolute);
  const extension = path.extname(file).toLowerCase();
  const content = fs.readFileSync(absolute, "utf8").replaceAll("\r\n", "\n");
  const lines = content.split("\n");
  totalLines += lines.length;
  let symbols = [];

  if ([".ts", ".tsx", ".js", ".cjs", ".mjs"].includes(extension)) {
    const sourceFile = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      syntaxKindForFile(file),
    );
    symbols = collectSymbols(sourceFile);
  }
  totalSymbols += symbols.length;

  fileRows.push(
    [
      file,
      lines.length,
      fileRole(file),
      extension,
      symbols.length,
      `该文件属于“${fileRole(file)}”模块`,
    ]
      .map(csv)
      .join(","),
  );

  for (const symbol of symbols) {
    symbolRows.push(
      [
        file,
        symbol.start,
        symbol.end,
        symbol.name,
        symbol.kind,
        symbol.description,
      ]
        .map(csv)
        .join(","),
    );
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const containing = symbols
      .filter((symbol) => symbol.start <= lineNumber && symbol.end >= lineNumber)
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0];
    const trimmed = lines[index].trim();
    const [lineKind, purpose] = classifyLine(trimmed, extension);
    lineRows.push(
      [
        file,
        lineNumber,
        containing?.name ?? "(模块顶层)",
        lineKind,
        containing
          ? `${purpose}；属于“${containing.name}”${containing.kind}`
          : `${purpose}；属于文件顶层`,
        trimmed.slice(0, 240),
      ]
        .map(csv)
        .join(","),
    );
  }
}

const utf8Bom = "\uFEFF";
fs.writeFileSync(path.join(outputDir, "file-inventory.csv"), `${utf8Bom}${fileRows.join("\n")}\n`, "utf8");
fs.writeFileSync(path.join(outputDir, "symbol-index.csv"), `${utf8Bom}${symbolRows.join("\n")}\n`, "utf8");
fs.writeFileSync(path.join(outputDir, "line-index.csv"), `${utf8Bom}${lineRows.join("\n")}\n`, "utf8");
fs.writeFileSync(
  path.join(outputDir, "coverage.json"),
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      files: files.length,
      lines: totalLines,
      symbols: totalSymbols,
      excludedDirectories: [...excludedDirectories],
      excludedSensitiveFiles: [".env.local"],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  JSON.stringify({
    outputDir,
    files: files.length,
    lines: totalLines,
    symbols: totalSymbols,
  }),
);
