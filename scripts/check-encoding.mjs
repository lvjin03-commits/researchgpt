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

const suspiciousFragments = [
  "\uFFFD",
  "\u951F",
  "\u9435",
  "\u9365",
  "\u95C7",
  "\u93C2",
  "\u9359",
  "\u93C8",
  "\u95B8",
  "\u95C4",
  "\u95B0",
  "\u95BA",
  "\u7F01",
  "\u95C1",
  "\u5A34",
  "\u6FE1",
  "\u59DE",
  "\u93C9",
  "\u95C6",
  "\u9366",
  "\u9621",
  "\u93AE",
  "\u93CB",
  "\u9629",
  "\u95C8",
  "\u921E",
  "\u740D",
  "\u8A2F",
  "\u9359",
  "\u9363",
  "\u93C8",
  "\u9411",
  "\u9422",
  "\u9428",
  "\u93C2",
  "\u9363",
  "\u9359",
  "\u93C7",
  "\u9422",
  "\u6EE1",
  "\u6769",
  "\u95C6",
  "\u7F01",
  "\u6D60",
  "\u6FE1",
  "\u7F02",
  "\u93C0",
  "\u93C9",
  "\u9368",
  "\u9422",
  "\u93C1",
  "\u9422",
  "\u93C2",
  "\u6A94",
  "\u93C7",
  "\u9365",
  "\u9359",
  "\u936B",
  "\u92C6",
  "\u9357",
  "\u93B6",
  "\u93B5",
  "\u93BB",
  "\u95C2",
  "\u93C9",
  "\u9369",
  "\u93C7",
  "\u93B5",
  "\u9366",
  "\u93B8",
  "\u93B0",
  "\u93B1",
  "\u93B4",
  "\u95BA",
  "\u93C6",
  "\u93C8",
  "\u93C9",
  "\u93CB",
  "\u93CE",
  "\u93D0",
  "\u93D1",
  "\u93D2",
  "\u93D5",
  "\u93D8",
  "\u93E6",
  "\u93E7",
  "\u93F0",
  "\u93F5",
  "\u93F6",
  "\u93F7",
  "\u93F8",
  "\u93F9",
  "\u93FA",
  "\u9414",
  "\u9415",
  "\u9416",
  "\u9417",
  "\u9418",
  "\u9419",
  "\u9420",
  "\u9421",
  "\u9423",
  "\u9424",
  "\u9425",
  "\u9426",
  "\u9427",
  "\u9428",
  "\u9429",
  "\u9430",
  "\u9431",
  "\u9432",
  "\u9433",
  "\u9434",
  "\u9435",
  "\u9436",
  "\u9437",
  "\u9438",
  "\u9439",
];

const westernMojibakePatterns = [/[\u00C3\u00C2]./, /\u00E2[\u0080-\u00BF]./];

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

function looksSuspicious(line) {
  if (suspiciousFragments.some((fragment) => line.includes(fragment))) {
    return true;
  }

  return westernMojibakePatterns.some((pattern) => pattern.test(line));
}

const findings = [];

for await (const filePath of walk(ROOT)) {
  const content = await readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (looksSuspicious(line)) {
      findings.push({
        filePath: path.relative(ROOT, filePath),
        line: index + 1,
        text: line.trim().slice(0, 220),
      });
    }
  });
}

if (findings.length > 0) {
  console.error("Suspicious mojibake text was found:");
  for (const finding of findings.slice(0, 80)) {
    console.error(`${finding.filePath}:${finding.line}: ${finding.text}`);
  }
  if (findings.length > 80) {
    console.error(`...and ${findings.length - 80} more findings.`);
  }
  process.exit(1);
}

console.log("Encoding check passed.");
