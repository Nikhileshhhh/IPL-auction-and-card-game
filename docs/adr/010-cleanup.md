# ADR-010: Cleanup: recoverable asynchronous deletion

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR10); DB/realtime §1–§4.

## Context and alternatives
Immediate delete vs recoverable task.

## Risks
Lost medals/orphan files vs TTL complexity.

## Decision
Commit receipts and results atomically, 120 s results TTL, then `cleanup_tasks`: freeze → delete Storage prefix → verify absent → delete root (cascade).

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
