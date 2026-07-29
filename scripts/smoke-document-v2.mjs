import JSZip from "jszip";
import { randomUUID } from "node:crypto";

const origin = process.env.DOCUMENT_V2_SMOKE_ORIGIN?.trim();
const cookie = process.env.DOCUMENT_V2_SMOKE_AUTH_COOKIE?.trim();

if (!origin || !cookie) {
  console.error(
    "Set DOCUMENT_V2_SMOKE_ORIGIN and DOCUMENT_V2_SMOKE_AUTH_COOKIE before running the document smoke test.",
  );
  process.exit(1);
}

const jobId = randomUUID();
const headers = {
  "Content-Type": "application/json",
  Cookie: cookie,
};
const created = await fetch(new URL("/api/document-v2/jobs", origin), {
  method: "POST",
  headers,
  body: JSON.stringify({
    idempotencyKey: jobId,
    instruction:
      "Generate an approximately 300-word English SCI-style test review about Physical Gel Preparation. Do not generate figures and do not invent or include references.",
    language: "en",
    targetLength: 300,
    source: { kind: "prompt", sourceIds: [] },
  }),
  redirect: "error",
});

if (!created.ok) {
  throw new Error(
    `Document smoke intake failed with HTTP ${created.status}: ${(await created.text()).slice(0, 1_000)}`,
  );
}

const deadline = Date.now() + 10 * 60_000;
let snapshot = await created.json();

while (
  !["completed", "failed", "cancelled", "dead_letter", "budget_exhausted"].includes(
    snapshot.job.status,
  )
) {
  if (snapshot.job.status === "awaiting_user_input") {
    throw new Error("Smoke job unexpectedly requested clarification.");
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `Document smoke job timed out at ${snapshot.job.stage} (${snapshot.job.progress}%).`,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const response = await fetch(
    new URL(`/api/document-v2/jobs/${jobId}`, origin),
    { headers: { Cookie: cookie }, cache: "no-store", redirect: "error" },
  );
  if (!response.ok) {
    throw new Error(
      `Document smoke polling failed with HTTP ${response.status}.`,
    );
  }
  snapshot = await response.json();
}

if (snapshot.job.status !== "completed" || !snapshot.job.artifactId) {
  throw new Error(
    `Document smoke job ended as ${snapshot.job.status} at ${snapshot.job.stage}.`,
  );
}

const download = await fetch(
  new URL(`/api/download/${snapshot.job.artifactId}`, origin),
  { headers: { Cookie: cookie }, redirect: "error" },
);
if (!download.ok) {
  throw new Error(`Document smoke download failed with HTTP ${download.status}.`);
}

const contentType = download.headers.get("content-type") ?? "";
if (
  !contentType.includes(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  )
) {
  throw new Error(`Unexpected document content type: ${contentType}`);
}

const buffer = Buffer.from(await download.arrayBuffer());
const archive = await JSZip.loadAsync(buffer);
if (!archive.file("[Content_Types].xml") || !archive.file("word/document.xml")) {
  throw new Error("Downloaded artifact is not a valid DOCX package.");
}
const documentXml = await archive.file("word/document.xml").async("string");
const visibleText = documentXml
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
if (visibleText.length < 100) {
  throw new Error("Downloaded DOCX does not contain enough visible content.");
}

console.log(
  JSON.stringify({
    ok: true,
    jobId,
    artifactId: snapshot.job.artifactId,
    bytes: buffer.length,
    visibleTextCharacters: visibleText.length,
  }),
);
