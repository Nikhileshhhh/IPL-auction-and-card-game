# ADR-015: Session and gate transport

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR15); DB/realtime §1–§4.

## Context and alternatives
Browser JWT vs server-only BFF cookies.

## Risks
BFF adds a hop and CSRF handling.

## Decision
HttpOnly Secure SameSite=Lax cookies on the Next server, opaque gate grant cookie, session-bound CSRF + exact Origin checks, one-use 30 s socket tickets sent in the Socket.IO auth payload.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
