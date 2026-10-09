# ADR-002: API framework: Fastify modular monolith

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR02); DB/realtime §1–§4.

## Context and alternatives
Fastify plugins/schema routing vs NestJS DI.

## Risks
Fastify needs explicit module boundaries.

## Decision
Fastify with module registration (`apps/server/src/modules/*`) and shared Zod contracts. Socket and HTTP adapters call the same command handler.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
