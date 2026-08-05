import assert from "node:assert/strict";

import { resolveRequestedExportFormats } from "../lib/chat/export-format-policy.ts";

assert.deepEqual(
  resolveRequestedExportFormats({
    routedOutputType: "word",
    fallbackFormats: ["docx", "pdf"],
    explicitlyRequestsFileCreation: true,
  }),
  ["docx"],
  "an uploaded PDF must not become a requested output when the router selected Word",
);

assert.deepEqual(
  resolveRequestedExportFormats({
    routedOutputType: "pdf",
    fallbackFormats: ["docx", "pdf"],
    explicitlyRequestsFileCreation: true,
  }),
  ["pdf"],
  "the routed artifact type must remain authoritative",
);

assert.deepEqual(
  resolveRequestedExportFormats({
    routedOutputType: "chat",
    fallbackFormats: ["pdf", "pdf"],
    explicitlyRequestsFileCreation: true,
  }),
  ["pdf"],
  "format inference remains available when routing did not select an artifact type",
);

assert.deepEqual(
  resolveRequestedExportFormats({
    routedOutputType: "chat",
    fallbackFormats: [],
    explicitlyRequestsFileCreation: true,
  }),
  ["docx"],
  "explicit file creation keeps the existing Word default",
);

assert.deepEqual(
  resolveRequestedExportFormats({
    routedOutputType: "chat",
    fallbackFormats: [],
    explicitlyRequestsFileCreation: false,
  }),
  [],
);

console.log("Chat export format policy checks passed.");
