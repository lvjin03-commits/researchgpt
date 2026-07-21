"use client";

import { CloudSyncError } from "@/lib/chat/cloud-types";
import { getAuthenticatedUserId } from "@/lib/chat/cloud-sync";
import {
  normalizeWorkspaceStorage,
  type WorkspaceStorage,
} from "@/lib/chat/workspace";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";

type ResearchWorkspaceRow = {
  user_id: string;
  projects: Json;
  active_project_id: string | null;
  updated_at: string;
};

export async function fetchCloudWorkspace(): Promise<WorkspaceStorage | null> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { data, error } = await supabase
    .from("research_workspaces")
    .select("user_id, projects, active_project_id, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new CloudSyncError("Failed to load research workspace", error);
  }

  if (!data) return null;

  const row = data as ResearchWorkspaceRow;
  return normalizeWorkspaceStorage({
    projects: row.projects,
    activeProjectId: row.active_project_id,
  });
}

export async function upsertCloudWorkspace(
  workspace: WorkspaceStorage,
): Promise<void> {
  const supabase = createClient();
  const userId = await getAuthenticatedUserId();

  const { error } = await supabase.from("research_workspaces").upsert(
    {
      user_id: userId,
      projects: workspace.projects as unknown as Json,
      active_project_id: workspace.activeProjectId,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new CloudSyncError("Failed to sync research workspace", error);
  }
}
