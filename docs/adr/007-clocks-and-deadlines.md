# ADR-007: Clocks and deadlines: durable deadlines

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR07); DB/realtime §1–§4.

## Context and alternatives
Durable deadline rows vs setTimeout authority.

## Risks
Polling cost; memory timers vanish on restart.

## Decision
Persist deadline + generation on the target row and a `deadline_jobs` wakeup row. Outcomes use DB `clock_timestamp()` read after the room lock. In-memory timers are hints only.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
