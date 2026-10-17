# AGENTS.md — working conventions for STUMPS

Read `docs/spec/CODEX_IMPLEMENTATION_PROMPTS.md` (shared execution contract) and the relevant
normative spec sections before changing behavior. Decisions live in `docs/adr/`; requirement →
phase → test mapping lives in `docs/requirements-traceability.md`.

## Layout
- `apps/web` — Next.js App Router (Vercel). Browser-safe code only; talks to the API through the same-origin BFF.
- `apps/server` — Fastify + Socket.IO modular monolith (Render). PostgreSQL is authoritative.
- `packages/contracts` — browser-safe Zod DTOs, command/event enums, error codes. JSON catalogs in `schema/` must match (`pnpm contracts:check`).
- `packages/game-engines` — server-only, IO-free pure reducers. No `Date.now`, `Math.random`, env, network or DB.
- `packages/ui` — design tokens and presentational primitives; no business authority.
- `supabase/migrations` — numbered, forward-only SQL migrations; never edit an applied file.

## Commands
`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `pnpm test:unit`,
`pnpm test:integration`, `pnpm test:security`, `pnpm test:concurrency`, `pnpm test:e2e`, `pnpm test:visual`,
`pnpm test:load`, `pnpm build`, `pnpm db:reset`, `pnpm db:lint`, `pnpm design:contrast`.
Local PostgreSQL: `scripts/db/local-pg.sh start` (port 54329, no Docker needed).

## Non-negotiables
- Never trust role, budget, deck, rating, outcome, score, vote count or medal from a client.
- All gameplay writes go through the room transaction wrapper (room lock first, idempotency receipt, durable events).
- Money is integer rupees (`bigint`, decimal strings on the wire). No floats.
- Every `app_private` table: FORCE RLS, backend policy, no browser grants, listed in `docs/migration-manifest.md`.
- Player portraits must render on every card and auction lot (ADR-017).
- Do not claim a check passed unless it was run; report blockers plainly.
