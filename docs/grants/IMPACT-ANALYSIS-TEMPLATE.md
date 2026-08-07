# Grant Platform Impact Analysis

Use this template before changing a core model, moving authority, adding a
cross-module dependency, changing sensitive-data handling, or introducing a
temporary compatibility path.

## Problem and Evidence

- Observed behavior:
- Reproduction or production evidence:
- Root cause:
- Why this is not only a symptom:

## Ownership

- Current authoritative owner:
- Owner after the change:
- Downstream consumers:
- Decisions downstream modules must not reinterpret:

## Scope

- Files/modules expected to change:
- User-visible behavior that must change:
- Existing behavior that must remain unchanged:
- Data/schema impact:
- Security/privacy impact:

## Options

- Chosen approach:
- Rejected alternatives:
- Why the change does not create parallel authority:
- Code or path that will be removed:

## Migration and Rollback

- Compatibility period:
- Removal condition:
- Feature flag:
- Rollback behavior:
- Data readability after rollback:

## Verification

- Contract test:
- Architecture check:
- Regression scenarios:
- Real user-path check:
- Real file/output inspection:
- What cannot yet be verified:
