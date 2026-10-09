# ADR-009: Auto mode: deterministic rules

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR09); DB/realtime §1–§4.

## Context and alternatives
Rules policy vs LLM strategy.

## Risks
LLM latency/cost/opaque spend.

## Decision
Rules-based constrained bids through the ordinary bid validator, `actorType=AUTO`, deterministic 700–1300 ms delay; observe-only when no strategy configured.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
