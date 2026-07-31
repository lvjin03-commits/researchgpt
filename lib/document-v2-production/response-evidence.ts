import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type EncryptedResponseEvidence = {
  encryptedContent: string | null;
  contentHash: string;
  sanitizedPreview: string;
};

function responseEvidenceKey() {
  const configured = process.env.DOCUMENT_V2_RESPONSE_ENCRYPTION_KEY?.trim();
  if (!configured) return null;
  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== 32) {
    throw new Error(
      "DOCUMENT_V2_RESPONSE_ENCRYPTION_KEY must encode exactly 32 bytes.",
    );
  }
  return key;
}

function sanitizePreview(content: string) {
  return content
    .slice(0, 500)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[id]")
    .replace(
      /((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;}]+/gi,
      "$1[redacted]",
    );
}

export function protectResponseEvidence(
  content: string,
): EncryptedResponseEvidence {
  const key = responseEvidenceKey();
  const contentHash = createHash("sha256").update(content).digest("hex");
  const sanitizedPreview = sanitizePreview(content);
  if (!key) return { encryptedContent: null, contentHash, sanitizedPreview };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(content, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    encryptedContent: [
      "v1",
      iv.toString("base64"),
      tag.toString("base64"),
      encrypted.toString("base64"),
    ].join("."),
    contentHash,
    sanitizedPreview,
  };
}

export function revealResponseEvidence(encryptedContent: string) {
  const key = responseEvidenceKey();
  if (!key) return null;
  const [version, ivText, tagText, encryptedText] = encryptedContent.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Stored response evidence has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivText, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
