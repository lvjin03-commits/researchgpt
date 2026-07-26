import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "release",
  "release-installer",
  "release-local",
  "release-local-v2",
  "tmp",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
]);

const mojibakePatterns = [
  { label: "replacement-character", pattern: /\uFFFD/u },
  { label: "utf8-as-gbk-generated", pattern: /\u9422\u7194\u6D60\u57DA/u },
  { label: "utf8-as-gbk-file", pattern: /\u93C2\u56E8\u6D60[\u3002\u5B58]/u },
  { label: "utf8-as-gbk-content", pattern: /\u9350\u5C83/u },
  { label: "utf8-as-gbk-table", pattern: /\u741B\u3126\u7243/u },
  { label: "utf8-as-gbk-link", pattern: /\u93C8[\u7459\u7481]/u },
  { label: "utf8-as-gbk-format", pattern: /\u93CD\u714E\u5F0F/u },
  { label: "utf8-as-gbk-rare-cjk-cluster", pattern: /[\u9300-\u943F][\u3000-\u9FFF]{1,8}/u },
  { label: "curly-quote-mojibake", pattern: /\u9225[\u003F\u6A9A\u6A9B]?/u },
  { label: "western-utf8-as-latin1", pattern: /\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{1,2}/u },
];

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(fullPath);
      continue;
    }

    if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield fullPath;
    }
  }
}

function findMojibake(line) {
  return mojibakePatterns.find(({ pattern }) => pattern.test(line));
}

const findings = [];

for await (const filePath of walk(ROOT)) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const finding = findMojibake(line);
    if (finding) {
      findings.push({
        filePath: path.relative(ROOT, filePath),
        line: index + 1,
        label: finding.label,
        text: line.trim().slice(0, 220),
      });
    }
  });
}

if (findings.length > 0) {
  console.error("Suspicious mojibake text was found:");
  for (const finding of findings.slice(0, 80)) {
    console.error(
      `${finding.filePath}:${finding.line} [${finding.label}]: ${finding.text}`,
    );
  }
  if (findings.length > 80) {
    console.error(`...and ${findings.length - 80} more findings.`);
  }
  process.exit(1);
}

console.log("Encoding and mojibake check passed.");
