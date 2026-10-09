# ADR-001: Frontend framework: Next.js App Router

- **Status:** Accepted (STUMPS v1.0, 9 October 2026)
- **Source:** Master plan §4 (ADR01); DB/realtime §1–§4.

## Context and alternatives
Next App Router (layouts, server session routes, route groups) vs SPA/Vite.

## Risks
App Router caching can leak private data if misconfigured.

## Decision
Next.js App Router on Vercel. All private responses `Cache-Control: private, no-store`; server-side auth checks in protected layouts AND every API call; game views are client islands loaded with dynamic imports.

## Consequences
Implementation must follow this decision in every phase; a change requires a superseding ADR and updates to the affected specifications, contracts and tests (CODEX prompts, "Release blockers and change control").
