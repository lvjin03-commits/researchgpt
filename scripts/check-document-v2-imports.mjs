import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const documentV2Root = path.join(root, "lib", "document-v2");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const forbiddenForV2 = [
  "@/app/api/chat/route",
  "@/app/api/",
  "@/lib/chat/",
  "@/lib/ai/",
  "@/lib/export/word-pipeline",
  "@/lib/export/document-spec",
  "@/lib/export/artifact-boundary",
];
const forbiddenForRenderers = [
  "@/lib/chat/",
  "@/lib/ai/",
  "@/lib/export/word-pipeline",
  "@/lib/export/document-spec",
  "@/lib/export/artifact-boundary",
];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolute);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      yield absolute;
    }
  }
}

const violations = [];
for await (const absolute of walk(documentV2Root)) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  const importPattern =
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    const imported = match[1] ?? match[2] ?? "";
    for (const forbidden of forbiddenForV2) {
      if (
        imported === forbidden ||
        imported.startsWith(
          forbidden.endsWith("/") ? forbidden : `${forbidden}/`,
        )
      ) {
        violations.push(`${relative}: document v2 must not import ${imported}`);
      }
    }
    if (relative.startsWith("lib/document-v2/renderers/")) {
      for (const forbidden of forbiddenForRenderers) {
        if (imported === forbidden || imported.startsWith(forbidden)) {
          violations.push(`${relative}: renderer must not import ${imported}`);
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Document v2 architecture import check passed.");
}
