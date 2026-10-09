# ADR-005: Identity: Supabase Auth with closed enrollment

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR05); DB/realtime §1–§4.

## Context and alternatives
Supabase Auth vs custom auth.

## Risks
Custom auth increases account security burden.

## Decision
Supabase Auth (email/password, recovery, TOTP MFA). Public signup and anonymous sign-in disabled. Separate gate grant and DB-assigned roles; never trust `user_metadata`. See ADR-016 for the local development adapter.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
