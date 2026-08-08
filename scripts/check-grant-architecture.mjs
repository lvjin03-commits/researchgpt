import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const violations = [];

const requiredGovernanceFiles = [
  "docs/grants/ARCHITECTURE.md",
  "docs/grants/DOMAIN-CONTRACTS.md",
  "docs/grants/IMPLEMENTATION-PLAN.md",
  "docs/grants/PR-CHECKLIST.md",
  "docs/grants/TECH-DEBT.md",
  "docs/grants/IMPACT-ANALYSIS-TEMPLATE.md",
  "docs/grants/QUALITY-METRICS.md",
  "docs/grants/DECISIONS/README.md",
  "docs/grants/EXCEPTIONS/README.md",
];

for (const relative of requiredGovernanceFiles) {
  try {
    await access(path.join(root, relative));
  } catch {
    violations.push(`${relative}: required grant governance file is missing`);
  }
}

async function exists(absolute) {
  try {
    await access(absolute);
    return true;
  } catch {
    return false;
  }
}

async function* walk(directory) {
  if (!(await exists(directory))) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(absolute);
    else if (sourceExtensions.has(path.extname(entry.name))) yield absolute;
  }
}

const exceptionsRoot = path.join(root, "docs", "grants", "EXCEPTIONS");
if (await exists(exceptionsRoot)) {
  for (const entry of await readdir(exceptionsRoot, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".md") ||
      entry.name === "README.md" ||
      entry.name === "template.md"
    ) {
      continue;
    }

    const relative = `docs/grants/EXCEPTIONS/${entry.name}`;
    const source = await readFile(path.join(exceptionsRoot, entry.name), "utf8");
    const status = source.match(/^- Status:\s*(.+)$/m)?.[1]?.trim().toLowerCase();
    const approvedBy = source.match(/^- Approved by:\s*(.+)$/m)?.[1]?.trim();
    const expiresAt = source.match(/^- Expires at:\s*(.+)$/m)?.[1]?.trim();

    if (!status || !expiresAt) {
      violations.push(`${relative}: exception must declare Status and Expires at`);
      continue;
    }
    if (status === "approved" && !approvedBy) {
      violations.push(`${relative}: approved exception must declare Approved by`);
    }
    if (status === "approved") {
      const expiry = Date.parse(expiresAt);
      if (Number.isNaN(expiry)) {
        violations.push(`${relative}: Expires at must be an ISO date`);
      } else if (expiry < Date.now()) {
        violations.push(`${relative}: approved engineering exception has expired`);
      }
    }
  }
}

function importsOf(source) {
  return [...source.matchAll(
    /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]|require\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  )].map((match) => match[1] ?? match[2] ?? "");
}

const grantRoots = [
  path.join(root, "app", "grants"),
  path.join(root, "app", "api", "grants"),
  path.join(root, "components", "grants"),
  path.join(root, "lib", "grants"),
];

const forbiddenForAllGrantCode = [
  "@/app/api/chat/route",
  "@/lib/document-v2/orchestration",
  "@/lib/document-v2-production",
  "@/lib/document-v2/runtime",
];

for (const directory of grantRoots) {
  for await (const absolute of walk(directory)) {
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    const source = await readFile(absolute, "utf8");
    const imports = importsOf(source);

    for (const imported of imports) {
      if (
        forbiddenForAllGrantCode.some(
          (prefix) => imported === prefix || imported.startsWith(`${prefix}/`),
        )
      ) {
        violations.push(`${relative}: forbidden cross-context dependency ${imported}`);
      }

      const modelAdapter = relative.startsWith("lib/grants/infrastructure/model/");
      if (imported === "openai" && !modelAdapter) {
        violations.push(
          `${relative}: direct model providers are allowed only in lib/grants/infrastructure/model/`,
        );
      }
    }

    if (relative.startsWith("lib/grants/domain/")) {
      for (const imported of imports) {
        if (
          imported === "next" ||
          imported.startsWith("next/") ||
          imported === "react" ||
          imported.startsWith("@supabase/") ||
          imported.startsWith("@/lib/grants/infrastructure") ||
          imported === "openai"
        ) {
          violations.push(`${relative}: domain must not import ${imported}`);
        }
      }
    }

    if (relative.startsWith("lib/grants/diagnostics/")) {
      for (const imported of imports) {
        if (
          imported.startsWith("@/lib/grants/infrastructure") ||
          imported.startsWith("@/lib/grants/server") ||
          imported.includes("/infrastructure/") ||
          imported.includes("/server/") ||
          imported.startsWith("next/") ||
          imported.startsWith("@supabase/")
        ) {
          violations.push(`${relative}: diagnostics must not persist or depend on runtime infrastructure via ${imported}`);
        }
      }
    }

    const uiOrRoute =
      relative.startsWith("app/grants/") ||
      relative.startsWith("app/api/grants/") ||
      relative.startsWith("components/grants/");
    if (uiOrRoute) {
      for (const imported of imports) {
        if (
          imported.startsWith("@supabase/") ||
          imported.startsWith("@/lib/grants/infrastructure/")
        ) {
          violations.push(
            `${relative}: UI/API must use application services, not ${imported}`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Grant architecture governance and dependency checks passed.");
}
