# ADR-013: Database pooling

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR13); DB/realtime §1–§4.

## Context and alternatives
Direct/session vs transaction pooler.

## Risks
Session features unavailable through transaction pooling.

## Decision
`pg` pool max 5 at launch (10 after measurement), unnamed queries, `SET LOCAL` only; separate migration connection; runtime role cannot migrate.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
