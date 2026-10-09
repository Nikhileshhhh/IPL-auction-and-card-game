# ADR-008: State sync: snapshot + audience streams

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR08); DB/realtime §1–§4.

## Context and alternatives
Event-only vs snapshot-only.

## Risks
Event-only rebuild cost; snapshot-only loses causality.

## Decision
Authoritative permitted snapshot plus per-audience ordered event streams (`room`, `team`, `member`) with replay ≤500 events/256 KiB, else fresh snapshot.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
