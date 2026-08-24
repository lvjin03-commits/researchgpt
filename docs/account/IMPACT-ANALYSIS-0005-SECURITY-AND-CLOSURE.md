# Security and Account Closure Impact Analysis

Supabase Auth remains the only password and session authority. ResearchGPT does
not create a parallel device tracker. Account closure is split into readiness
and execution: Grant, Document and Billing must each own their blocker mapping;
the account lifecycle service may only aggregate their answers.

The first release does not expose deletion. Opening closure requests requires
all authority adapters, persisted request lifecycle, retention-policy approval
and end-to-end tests. Financial and required audit records are never physically
deleted merely because the Auth account closes.
