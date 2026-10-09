# ADR-006: Game state authority: PostgreSQL transactions

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR06); DB/realtime §1–§4.

## Context and alternatives
DB-first vs in-memory actors with snapshots.

## Risks
DB latency/lock contention.

## Decision
PostgreSQL is authoritative. Every gameplay mutation runs in the shared transaction wrapper that locks the room row first. Node keeps projections only.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
