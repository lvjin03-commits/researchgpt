import { LiteratureError } from "@/lib/literature/errors";
import {
  createLiteratureFolder,
  listLiteratureFolders,
} from "@/lib/literature/server/folder-repository";
import {
  extensionCorsHeaders,
  extensionCorsPreflight,
} from "@/lib/http/extension-cors";
import { parseFolderName } from "@/lib/literature/server/parse";
import { requireLiteratureUser } from "@/lib/literature/server/auth";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return extensionCorsPreflight(request);
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
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

    console.error("[literature] GET folders failed:", error);
    return Response.json(
      { error: "Failed to load folders." },
      { status: 500, headers: extensionCorsHeaders(request) },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireLiteratureUser();
    const body = await request.json();
    const name = parseFolderName(body);
    const folder = await createLiteratureFolder(supabase, user.id, name);
    return Response.json({ folder });
  } catch (error) {
    if (error instanceof LiteratureError) {
      return Response.json({ error: error.message }, { status: error.statusCode });
    }

    console.error("[literature] POST folder failed:", error);
    return Response.json({ error: "Failed to create folder." }, { status: 500 });
  }
}
