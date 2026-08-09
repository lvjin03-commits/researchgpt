import { parseDocument } from "@/lib/documents/parser";
import type { GrantEvidenceParser } from "../../ports/grant-evidence-parser.ts";

export class SharedGrantEvidenceParser implements GrantEvidenceParser {
  async parse(input: { buffer: Buffer; fileName: string }) {
    const parsed = await parseDocument(input.buffer, input.fileName);
    return { text: parsed.text, originalLength: parsed.originalLength, truncated: parsed.truncated };
  }
}
