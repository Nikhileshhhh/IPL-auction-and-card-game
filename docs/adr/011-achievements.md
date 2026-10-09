# ADR-011: Achievements: franchise ranked once, members credited

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR11); DB/realtime §1–§4.

## Context and alternatives
Per-franchise vs per-user ranking.

## Risks
Flat ranks inflate competition.

## Decision
Rank franchise once; credit eligible start-roster members with `scope=FRANCHISE` receipts and `creditedRole`.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
