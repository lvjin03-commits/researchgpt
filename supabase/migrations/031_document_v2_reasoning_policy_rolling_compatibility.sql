-- Permit the immediately preceding application release during a rolling
-- deployment. New code stores provider-neutral values and never writes these
-- legacy compound labels; they remain accepted only for deployment safety and
-- historical audit compatibility.

ALTER TABLE public.document_v2_model_executions
  DROP CONSTRAINT IF EXISTS document_v2_model_executions_effective_reasoning_effort_check,
  ADD CONSTRAINT document_v2_model_executions_effective_reasoning_effort_check
    CHECK (
      effective_reasoning_effort IS NULL OR
      effective_reasoning_effort IN (
        'none', 'low', 'medium', 'high', 'max',
        'disabled', 'enabled:high', 'enabled:max'
      )
    );

COMMENT ON CONSTRAINT document_v2_model_executions_effective_reasoning_effort_check
  ON public.document_v2_model_executions IS
  'Accepts provider-neutral effort plus legacy v1 compound labels for rolling-deployment and audit compatibility.';
