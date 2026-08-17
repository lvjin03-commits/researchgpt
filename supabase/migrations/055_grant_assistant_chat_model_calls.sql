-- Extend the existing Grant model-call authority for ordinary assistant chat.
-- This changes only the admitted operation/policy pair; storage and RPC ownership
-- remain with grant_model_calls and its existing service-role functions.

ALTER TABLE public.grant_model_calls
  DROP CONSTRAINT IF EXISTS grant_model_calls_operation_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_policy_version_check;

ALTER TABLE public.grant_model_calls
  ADD CONSTRAINT grant_model_calls_operation_check
    CHECK (operation IN ('grant.edit_session.turn', 'grant.assistant.chat')),
  ADD CONSTRAINT grant_model_calls_policy_version_check
    CHECK (
      (operation = 'grant.edit_session.turn' AND policy_version = 'grant-edit-session-turn-v1')
      OR
      (operation = 'grant.assistant.chat' AND policy_version = 'grant-assistant-chat-v1')
    );
