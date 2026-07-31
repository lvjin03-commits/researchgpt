import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const diagnosticsRoot = path.join(root, "lib", "document-v2", "diagnostics");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const forbiddenConsumers = [
  "lib/document-v2-production/",
  "lib/document-v2/runtime/",
  "lib/document-v2/orchestration/",
  "lib/document-v2/generation/",
  "lib/document-v2/assets/",
  "lib/document-v2/renderers/",
];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (sourceExtensions.has(path.extname(entry.name))) yield absolute;
  }
}

const violations = [];
for await (const absolute of walk(path.join(root, "lib"))) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  if (!forbiddenConsumers.some((prefix) => relative.startsWith(prefix))) {
    continue;
  }
  const source = await readFile(absolute, "utf8");
  if (source.includes("/document-v2/diagnostics")) {
    violations.push(`${relative}: execution code must not import diagnostics`);
  }
}

const repositorySource = await readFile(
  path.join(diagnosticsRoot, "repository.ts"),
  "utf8",
);
for (const forbidden of [
  ".insert(",
  ".update(",
  ".delete(",
  ".upsert(",
  ".rpc(",
  'select("*")',
  "raw_response",
  "job_payload",
]) {
  if (repositorySource.includes(forbidden)) {
    violations.push(`diagnostics repository contains forbidden token ${forbidden}`);
  }
}

const routeSource = await readFile(
  path.join(
    root,
    "app",
    "api",
    "document-v2",
    "jobs",
    "[id]",
    "diagnostics",
    "route.ts",
  ),
  "utf8",
);
for (const required of [
  "userClient.auth.getUser()",
  "getDocumentJobDiagnostics",
  '"Cache-Control": "private, no-store"',
]) {
  if (!routeSource.includes(required)) {
    violations.push(`diagnostics route is missing required guard ${required}`);
  }
}
for (const forbidden of [
  "export async function POST",
  "export async function PATCH",
  "export async function PUT",
  "export async function DELETE",
]) {
  if (routeSource.includes(forbidden)) {
    violations.push(`diagnostics route exposes forbidden mutation ${forbidden}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Document v2 diagnostics boundary check passed.");
}
