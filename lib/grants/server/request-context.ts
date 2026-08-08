import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createGrantEditorService } from "./composition.ts";
import { isGrantWorkspaceEnabled } from "./config.ts";

export class GrantWorkspaceDisabledError extends Error {}
export class GrantAuthenticationRequiredError extends Error {}

export async function requireGrantRequestContext() {
  if (!isGrantWorkspaceEnabled()) throw new GrantWorkspaceDisabledError();
  const userClient = await createClient();
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new GrantAuthenticationRequiredError();
  return { user, editor: createGrantEditorService(user.id) };
}
