# ADR-004: Repository: pnpm monorepo

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR04); DB/realtime §1–§4.

## Context and alternatives
Monorepo vs separate repos.

## Risks
Server code leaking into browser bundles.

## Decision
One pnpm workspace: `apps/web`, `apps/server`, `packages/{contracts,ui,game-engines,test-fixtures}`. Package `exports` + ESLint import restrictions + a CI dependency-boundary test forbid web importing `game-engines`/server/DB code.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
