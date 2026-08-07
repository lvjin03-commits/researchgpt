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

for await (const absolute of walk(path.join(root, "lib"))) {
  const relative = path.relative(root, absolute).replaceAll("\\", "/");
  const source = await readFile(absolute, "utf8");
  if (
    source.includes("STORM_RUNTIME_APPROVED") &&
    relative !== "lib/research-exploration/runtime-policy.ts"
  ) {
    violations.push(
      `${relative}: the global STORM switch may only be read by runtime-policy.ts`,
    );
  }
}

const planningIntegrationOwners = new Set([
  "lib/document-v2/runtime/contracts.ts",
  "lib/document-v2/planning/planner.ts",
  "lib/document-v2-production/planning.ts",
  "lib/document-v2-production/stages/intake.ts",
  "lib/document-v2-production/failure-mapper.ts",
  // Creation may launch the isolated exploration runtime. Only the planning
  // gate below may consume its non-authoritative advisory projection.
  "lib/document-v2-production/command-gateway.ts",
  // The optional pre-planning gate may only wait, persist advisory hints, or
  // degrade back to the existing Document V2 planner.
  "lib/document-v2-production/research-preparation.ts",
]);
for (const authoritativeRoot of [
  path.join(root, "lib", "document-v2"),
  path.join(root, "lib", "document-v2-production"),
]) {
  for await (const absolute of walk(authoritativeRoot)) {
    const source = await readFile(absolute, "utf8");
    if (source.includes("research-exploration")) {
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (planningIntegrationOwners.has(relative)) continue;
      violations.push(
        `${relative}: only the approved planning boundary may consume research exploration`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Research exploration boundary check passed.");
}
