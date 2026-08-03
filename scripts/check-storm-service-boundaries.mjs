import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const serviceRoot = path.join(root, "services", "storm-exploration");
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute);
    else if (entry.name.endsWith(".py")) files.push(absolute);
  }
}
collect(path.join(serviceRoot, "app"));

const failures = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const label = path.relative(root, file);
  if (/document[-_]v2/i.test(source)) failures.push(`${label}: imports or names Document V2`);
  if (/BackgroundTasks/.test(source)) failures.push(`${label}: runs long work in FastAPI BackgroundTasks`);
  if (/do_generate_article\s*=\s*True/.test(source)) failures.push(`${label}: enables STORM article generation`);
  if (/do_polish_article\s*=\s*True/.test(source)) failures.push(`${label}: enables STORM article polishing`);
  if (
    source.includes("STORM_RUNTIME_APPROVED") &&
    !label.replaceAll("\\", "/").endsWith("app/storm_adapter/runner_factory.py")
  ) {
    failures.push(`${label}: reads the global runtime switch outside runner_factory.py`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`STORM service boundaries verified across ${files.length} Python files.`);
