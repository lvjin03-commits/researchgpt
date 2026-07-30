import { createHash } from "node:crypto";

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function canonicalizeInternal(value: unknown): CanonicalValue {
  if (value === null) return null;
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    // Array order is semantic unless a caller explicitly sorts an unordered
    // business collection before hashing.
    return value.map(canonicalizeInternal);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeInternal(item)]),
    );
  }
  throw new TypeError(`Unsupported canonical hash value: ${typeof value}`);
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalizeInternal(value));
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
