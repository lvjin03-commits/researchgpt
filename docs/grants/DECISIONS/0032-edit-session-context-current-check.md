# ADR 0032: Rebuild edit context on every turn

## Decision

Edit Sessions do not own an authorization snapshot. Each turn asks the existing Evidence and Figure authorization owners for current admission, and the Model Data Gateway performs a second current-state check after generation.

Figures require all of `sendImageToModel` and `useForAiEditing`; `useForSemanticDiagnosis` does not imply editing permission. Image bytes are integrity checked and converted to execution-local provider input only inside the gateway.

Candidate dependency metadata is sufficient for a passive next-turn recheck. A failed recheck changes the Candidate to `needs_repair` and generation falls back to the nearest earlier `passed` Candidate or frozen source text.

## Consequences

Revocation takes effect on the next attempted turn without a new event system. Users do not invest additional turns on context the system already knows is invalid, and no cached model context becomes a second authorization authority.

