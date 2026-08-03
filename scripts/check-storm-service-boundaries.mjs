import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
const admissionPath = path.join(serviceRoot, "runtime-admission.json");
const runtimeInputPath = path.join(serviceRoot, "requirements-runtime.in");
const runnerFactoryPath = path.join(
  serviceRoot,
  "app",
  "storm_adapter",
  "runner_factory.py",
);

if (!fs.existsSync(admissionPath)) {
  failures.push("STORM runtime admission record is missing");
} else {
  const admission = JSON.parse(fs.readFileSync(admissionPath, "utf8"));
  if (admission.schemaVersion !== "storm-runtime-admission-v1") {
    failures.push("STORM runtime admission schema is invalid");
  }
  const runtimeInput = fs.readFileSync(runtimeInputPath, "utf8");
  const pinnedVersion = runtimeInput.match(/^knowledge-storm==([^\s]+)$/m)?.[1];
  if (pinnedVersion !== admission.runtime?.packageVersion) {
    failures.push("STORM runtime input and admission version differ");
  }
  const runtimeLock = admission.runtime?.lockFile;
  if (!runtimeLock) {
    failures.push("STORM runtime admission lacks a runtime lock file");
  } else {
    const runtimeLockPath = path.join(serviceRoot, runtimeLock);
    if (!fs.existsSync(runtimeLockPath)) {
      failures.push("STORM runtime lock file is missing");
    } else {
      const lockBytes = fs.readFileSync(runtimeLockPath);
      const lockHash = crypto.createHash("sha256").update(lockBytes).digest("hex");
      if (lockHash !== admission.runtime?.lockSha256) {
        failures.push("STORM runtime lock hash differs from admission record");
      }
      if (!lockBytes.toString("utf8").includes("--hash=sha256:")) {
        failures.push("STORM runtime lock is not hash-locked");
      }
    }
  }
  if (admission.approved === true) {
    if (admission.status !== "approved" || !admission.lockFile) {
      failures.push("Approved STORM admission lacks approved status or lock file");
    } else {
      const lockPath = path.join(serviceRoot, admission.lockFile);
      if (!fs.existsSync(lockPath)) {
        failures.push("Approved STORM admission lock file is missing");
      } else if (!fs.readFileSync(lockPath, "utf8").includes("--hash=sha256:")) {
        failures.push("Approved STORM runtime lock is not hash-locked");
      }
    }
  } else if (
    admission.status !== "blocked" ||
    admission.productionFlagMustRemainFalse !== true ||
    !Array.isArray(admission.blockers) ||
    admission.blockers.length === 0
  ) {
    failures.push("Blocked STORM admission must retain blockers and runtime-off policy");
  }
}

const dockerfilePath = path.join(serviceRoot, "Dockerfile");
const runtimeExamplePath = path.join(serviceRoot, "runtime.env.example");
if (!fs.existsSync(dockerfilePath)) {
  failures.push("STORM Linux Dockerfile is missing");
} else {
  const dockerfile = fs.readFileSync(dockerfilePath, "utf8");
  if (!dockerfile.includes("--require-hashes")) {
    failures.push("STORM Dockerfile does not install from the hash lock");
  }
  if (!dockerfile.includes('USER 10001')) {
    failures.push("STORM Dockerfile does not use the admitted non-root user");
  }
}
if (!fs.existsSync(runtimeExamplePath)) {
  failures.push("STORM runtime environment example is missing");
} else {
  const runtimeExample = fs.readFileSync(runtimeExamplePath, "utf8");
  if (!runtimeExample.includes("STORM_RUNTIME_APPROVED=false")) {
    failures.push("STORM runtime environment example must default to disabled");
  }
  if (!runtimeExample.includes("STORM_CANARY_APPROVED=false")) {
    failures.push("STORM canary environment example must default to disabled");
  }
}

const runnerFactorySource = fs.readFileSync(runnerFactoryPath, "utf8");
if (!runnerFactorySource.includes("and admission_approved()")) {
  failures.push("STORM runtime switch is not gated by the admission record");
}

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
