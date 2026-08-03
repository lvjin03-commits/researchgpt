import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const moduleRoot = path.join(root, "lib", "research-exploration");
const violations = [];

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (/\.ts$/.test(entry.name)) yield absolute;
  }
}

for await (const absolute of walk(moduleRoot)) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  const imports = [...source.matchAll(
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  )].map((match) => match[1] ?? "");
  for (const imported of imports) {
    if (
      imported.includes("document-v2") ||
      imported.includes("document-v2-production") ||
      imported.includes("supabase") ||
      imported.startsWith("@/app")
    ) {
      violations.push(`${relative}: research exploration must remain independent (${imported})`);
    }
  }
  if (/\bfetch\s*\(/.test(source)) {
    violations.push(`${relative}: transport must be injected; direct fetch is forbidden`);
  }
  for (const authoritativeType of ["VerifiedReference", "EvidenceRecord", "DocumentSkeleton"]) {
    if (source.includes(authoritativeType)) {
      violations.push(`${relative}: candidate module must not expose ${authoritativeType}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Research exploration boundary check passed.");
}
