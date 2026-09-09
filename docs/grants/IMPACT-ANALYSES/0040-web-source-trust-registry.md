# Impact analysis: source trust registry

Request: step 2 of automatic web-grounded Grant chat.

- New authority: a pure versioned registry owns domain classification only.
- Consumers: future approved search adapters; no runtime consumer added now.
- Existing web contracts, OpenAlex, snapshots, Evidence Cards, Model Data
  Gateway, canonical revisions and chat remain unchanged.
- No parallel search, evidence model, authorization path or retry loop.
- No external requests, costs, secrets, migrations or deployment.
- Risks: suffix spoofing, accidental authority inflation and policy drift.
  Mitigation: URL normalization, DNS-label boundary checks, deterministic
  precedence, immutable config, versioned results and offline regression tests.
- Verification: dedicated classifier tests, existing web-source tests,
  architecture gate and TypeScript. This does not verify live web Q&A.
- Rollback: remove unused foundation or restore prior registry version. Future
  source records must retain the version used at classification time.
