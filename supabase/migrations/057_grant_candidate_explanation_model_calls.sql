-- Admit the no-write Candidate explanation operation to the existing Grant
-- model-call authority. This adds no explanation cache or content table.

ALTER TABLE public.grant_model_calls
  DROP CONSTRAINT IF EXISTS grant_model_calls_operation_check,
  DROP CONSTRAINT IF EXISTS grant_model_calls_policy_version_check;

ALTER TABLE public.grant_model_calls
  ADD CONSTRAINT grant_model_calls_operation_check
    CHECK (operation IN (
      'grant.edit_session.turn',
      'grant.assistant.chat',
      'grant.edit_candidate.explain'
    )),
  ADD CONSTRAINT grant_model_calls_policy_version_check
    CHECK (
      (operation = 'grant.edit_session.turn' AND policy_version = 'grant-edit-session-turn-v1')
      OR
      (operation = 'grant.assistant.chat' AND policy_version = 'grant-assistant-chat-v1')
      OR
      (operation = 'grant.edit_candidate.explain' AND policy_version = 'grant-edit-candidate-explain-v1')
    );
