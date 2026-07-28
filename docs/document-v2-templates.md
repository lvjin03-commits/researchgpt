# Document v2 Template System

This document is authoritative for step 4 of the document-v2 migration.

## Resolution order

```text
DocumentRequest
  -> uploaded template present?
       yes -> UserTemplateAnalyzer -> normalized analysis
       no  -> active registry candidates -> semantic matcher decision
  -> deterministic validation
  -> immutable ResolvedTemplateSnapshot
  -> component blueprints for the planner
```

An uploaded template always takes precedence. The system-template matcher is
not called in that branch.

## System-template matching

The matcher receives the full resolved request and a closed candidate list. It
returns only:

- one candidate template ID;
- confidence;
- rationale.

The resolver rejects unknown, inactive, planned, retired, language-incompatible,
format-incompatible, or document-type-incompatible templates. The matcher
cannot invent a template or modify its version and rules.

The initial registry contains one active template:

| ID | Version | Content profile | Rendering profile |
|---|---|---|---|
| `sci-review` | `1` | `sci_review_v1` | `sci_word_v1` |

No placeholder templates are active.

## User-template branch

`UserTemplateAnalyzer` is an injected boundary for a future DOCX parser. Its
normalized result contains:

- parser analysis version;
- detected language and document type;
- Word style identities;
- supported layout rules;
- ordered component blueprints;
- explicit warnings for unsupported or ambiguous features.

The resolver, not the parser, assigns the runtime template identity and origin.
The current framework supports only templates that normalize into the SCI v1
contract. It does not pretend to preserve arbitrary uploaded-template features.

## Immutable snapshot

The snapshot contains:

- template ID and version;
- system or user-upload origin;
- content and rendering profile IDs;
- Word style identities;
- page layout;
- heading and caption-position rules;
- deterministic SHA-256 checksum.

The checksum is calculated from canonical JSON before the snapshot is deeply
frozen. Any rule or style change produces a different checksum. The same
snapshot travels through planning, orchestration, final specification, and
rendering; downstream modules cannot select another template.

## Fixed rules and AI decisions

The complete SCI v1 division is recorded in
`docs/templates/sci-review-v1.md`.

- The rendering profile owns fonts, sizes, margins, colors, captions,
  numbering, pagination, and Word Styles.
- AI owns mature semantic content within the resolved component blueprint.
- The planner may expand repeatable sections within template limits.
- Neither AI nor the planner may alter fixed rendering rules.

## Not yet implemented

- actual DOCX upload parsing;
- template file storage;
- additional system-template definitions;
- template-selection model adapter;
- production UI and route integration.
