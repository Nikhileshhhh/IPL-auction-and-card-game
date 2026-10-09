# ADR-012: Rule versions: immutable typed JSON policies

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR12); DB/realtime §1–§4.

## Context and alternatives
Hardcoded defaults vs versioned config.

## Risks
Config validation/provenance cost.

## Decision
Typed immutable JSON policies (Zod-validated, no executable code) + pure engine version + source manifest + hashes, frozen per room at start.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
