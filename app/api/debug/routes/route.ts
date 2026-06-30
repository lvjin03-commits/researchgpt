import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

function hasRoute(...segments: string[]): boolean {
  return existsSync(
    path.join(process.cwd(), "app", "api", ...segments, "route.ts"),
  );
}

export async function GET() {
  return Response.json({
    chat: hasRoute("chat"),
    attachments: hasRoute("chat", "attachments"),
    export: hasRoute("export"),
    translateDocx: hasRoute("translate", "docx"),
  });
}
