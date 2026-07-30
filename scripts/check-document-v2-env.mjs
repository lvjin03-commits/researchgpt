import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd());

const publicFlag = process.env.DOCUMENT_V2_PUBLIC_ENABLED?.trim();
const enabled =
  publicFlag !== undefined && publicFlag !== ""
    ? publicFlag === "true"
    : process.env.DOCUMENT_V2_RUNTIME_ENABLED === "true";

if (!enabled) {
  console.log("[document-v2-env] Public document-v2 runtime is disabled.");
  process.exit(0);
}

const required = [
  "CRON_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const missing = required.filter((name) => !process.env[name]?.trim());
const invalid = [];

if (
  process.env.CRON_SECRET &&
  process.env.CRON_SECRET.trim().length < 32
) {
  invalid.push("CRON_SECRET must contain at least 32 characters.");
}

if (missing.length || invalid.length) {
  console.error("[document-v2-env] Production deployment blocked.");
  if (missing.length) {
    console.error(`Missing variables: ${missing.join(", ")}`);
  }
  for (const issue of invalid) console.error(issue);
  process.exit(1);
}

console.log("[document-v2-env] Required production configuration is present.");
