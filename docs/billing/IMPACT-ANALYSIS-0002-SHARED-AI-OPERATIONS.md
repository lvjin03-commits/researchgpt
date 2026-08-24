# Impact Analysis 0002: Shared AI Operation and Usage Contracts

## Problem and Evidence

- General chat identifies work by `ChatTaskKind`.
- Document V2 repeated operation string literals in structured contracts and
  the provider adapter.
- Grant has an executable registry for assistant/edit calls, while diagnostic
  stage IDs exist in individual adapters.
- A Price Catalog cannot safely reference parallel naming surfaces.
- Edit Session is open-ended; reserving an entire session has no bounded total.

## Ownership

- The site-wide AI Operation Registry owns every new billable AI operation ID.
- Existing domain executors keep routing, retry and semantic authority.
- Standardized usage is factual provider/tool usage and cannot deduct points.
- One Grant Edit Turn, identified by its existing `turnId`, is one future
  billing Bundle. The Edit Session remains the candidate-chain owner.

## Scope and Compatibility

- Existing Document V2 and Grant runtime operation string values are preserved.
- General chat gains a deterministic mapping from existing task kinds to
  registered operations; routing behavior is unchanged.
- Legacy audit-only Grant operation values remain outside the executable shared
  registry and cannot be selected for new billing.
- Token, tool-call, image-input, image-generation, audio and video usage are
  represented without assuming one provider pricing unit.
- This step performs no estimate, reservation, deduction or payment.

## Chosen Approach

- One immutable `AI_OPERATIONS` registry with a derived union type.
- One strict discriminated standardized-usage contract.
- Existing Grant assistant/edit constants re-export shared values.
- Existing Document V2 contracts reference the shared owner without renaming
  persisted/logged values.
- Edit Session billing is per turn. Session creation, reads, Candidate Diff,
  Candidate application and discard are explicitly non-billable actions.

## Rejected Alternatives

- Pricing free-form operation strings.
- One fixed token structure for image/audio/video.
- Reserving a maximum for the lifetime of an Edit Session.
- Charging Candidate application after charging its generation turn.
- Renaming established operations during the authority migration.

## Verification

- Registry IDs are unique and unknown IDs fail closed.
- Every existing ChatTaskKind maps to one registered operation.
- Standardized usage rejects negative, fractional and unknown units.
- Cached input cannot exceed total input.
- An Edit Turn billing operation ID must equal its turn ID.
- Grant and Document V2 reference the shared registry.
- CI runs this contract with the point-ledger contracts.
