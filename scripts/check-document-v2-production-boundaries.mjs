import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const violations = [];

async function importsOf(relativePath) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  return [...source.matchAll(
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  )].map((match) => match[1] ?? match[2] ?? "");
}

async function assertNoImports(relativePath, forbidden) {
  const imports = await importsOf(relativePath);
  for (const imported of imports) {
    if (forbidden.some((prefix) => imported === prefix || imported.startsWith(`${prefix}/`))) {
      violations.push(`${relativePath}: forbidden dependency ${imported}`);
    }
  }
}

await assertNoImports("app/api/chat/route.ts", [
  "@/lib/document-v2/runtime/job-service",
  "@/lib/document-v2/runtime/supabase-repository",
  "@/lib/document-v2-production/dispatch",
]);

await assertNoImports("lib/document-v2-production/worker.ts", [
  "@/lib/document-v2/renderers/docx",
  "@/lib/document-v2/renderers/quality",
  "@/lib/document-v2/assembly/manifest",
  "@/lib/export",
  "@/lib/uploads/storage-constants",
  "@/lib/document-v2/templates/resolver",
  "@/lib/document-v2/references/acquisition",
]);

const workerSource = await readFile(
  path.join(root, "lib/document-v2-production/worker.ts"),
  "utf8",
);
if (workerSource.split(/\r?\n/).length > 400) {
  violations.push(
    "lib/document-v2-production/worker.ts: worker exceeded the 400-line structural warning limit",
  );
}

await assertNoImports("lib/document-v2/orchestration/orchestrator.ts", [
  "../renderers",
  "@/lib/document-v2/renderers",
]);

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) yield absolute;
  }
}

for await (const absolute of walk(path.join(root, "lib", "document-v2", "assembly"))) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const imports = await importsOf(relative);
  for (const imported of imports) {
    if (
      imported.includes("document-v2-production") ||
      imported.startsWith("@/lib/ai") ||
      imported.includes("/renderers/")
    ) {
      violations.push(`${relative}: assembly must remain deterministic (${imported})`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Document v2 production boundary check passed.");
}
