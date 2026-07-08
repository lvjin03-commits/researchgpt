import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { LiteratureError } from "@/lib/literature/errors";
import { listLiteratureFolders } from "@/lib/literature/server/folder-repository";
import { requireExtensionUser } from "@/lib/literature/server/extension-auth";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireExtensionUser(request);
    const folders = await listLiteratureFolders(supabase, user.id);

    return Response.json(
      { folders },
      { headers: extensionCorsHeaders(request) },
    );
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json(
        { error: error.message },
        {
          status: error.statusCode,
          headers: extensionCorsHeaders(request),
        },
      );
    }

    console.error("[extension] folders failed:", error);
    return Response.json(
      { error: "Failed to load folders." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}
