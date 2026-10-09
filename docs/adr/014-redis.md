# ADR-014: Redis

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR14); DB/realtime §1–§4.

## Context and alternatives
No Redis vs Socket.IO Redis adapter.

## Risks
Redis outage must not change authority.

## Decision
No Redis initially. Add the adapter only with multi-instance load evidence and a new ADR; PG replay remains the recovery path.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
