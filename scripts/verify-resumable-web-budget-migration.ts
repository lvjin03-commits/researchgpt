import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/070_resumable_grant_web_answer_budgets.sql", import.meta.url), "utf8");
for (const fragment of ["CREATE TABLE public.grant_web_answer_budgets",
  "CREATE TABLE public.grant_web_answer_budget_authorizations", "FOR UPDATE",
  "PERFORM public.reserve_points", "PERFORM public.settle_point_reservation",
  "PERFORM public.release_point_reservation", "p_expected_version",
  "CREATE FUNCTION public.transition_grant_web_answer_budget",
  "CREATE FUNCTION public.authorize_grant_web_answer_budget_increase",
  "p_checkpoint JSONB",
  "checkpoint=COALESCE(p_checkpoint,checkpoint)",
  "jsonb_array_elements(p_next_state->'authorizations')",
  "grant_web_budget_conflict", "TO service_role"]) {
  assert.ok(sql.includes(fragment), `migration must contain ${fragment}`);
}
assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]* TO (?:anon|authenticated)/u,
  "budget mutation RPCs must remain service-role-only");
assert.match(sql, /reserve_points[\s\S]*UPDATE public\.grant_web_answer_budgets/u);
assert.match(sql, /settle_point_reservation[\s\S]*UPDATE public\.grant_web_answer_budgets/u);
assert.match(sql, /p_checkpoint->>'documentId'[\s\S]*p_checkpoint->>'turnId'/u);
console.log("Resumable web-answer budget migration atomicity contract passed.");
