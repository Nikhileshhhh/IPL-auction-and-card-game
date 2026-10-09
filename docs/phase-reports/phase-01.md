# Phase 01 report — Initialize runnable monorepo

**Date:** 2026-10-09 · **Result:** complete.

## Changed paths
- Root: `package.json` (13 required scripts), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `tsconfig.tests.json`, `eslint.config.mjs`, `.prettierrc.json`, `vitest.config.ts` (projects unit/integration/security/concurrency), `playwright.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `AGENTS.md`, `.nvmrc`, `.npmrc`.
- `apps/server`: `src/app.ts`, `src/main.ts`, `src/config/env.ts`, `src/observability/logger.ts` (redaction paths), `src/http/{app-error,envelope,readiness}.ts`, `src/routes/{health,v1/index}.ts`, `src/realtime/gateway.ts`, `src/db/pool.ts`, `tsup.config.ts`, unit tests.
- `apps/web`: Next.js 16 App Router shell, route groups `(public)`, `(member)`, `(admin)`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `components/shell/*` (AppShell, Wordmark, PlaceholderPanel, ErrorBoundary), `lib/{features,env.server,env.public}.ts`.
- `packages/contracts/src/*` (errors, primitives, envelope, commands, events, health), `packages/game-engines/src/index.ts`, `packages/ui/src/{tokens.ts,tokens.css}`.
- `scripts/verify-contracts/index.ts`, `scripts/db/{lib,reset,lint}.ts`, `scripts/db/local-pg.sh`, `supabase/config.toml`, `tests/unit/dependency-boundaries.spec.ts`, `tests/e2e/shell.spec.ts`, `tests/load/run.ts`.

## Behavior
- `GET /health/live` → 200 envelope. `GET /health/ready` → 503 unless every registered check passes; with no `DATABASE_URL` it reports `database: DATABASE_URL not configured` (health 200 is **not** treated as game readiness).
- `/v1` prefix with `private, no-store`, shared success/failure envelope, server-generated request IDs (client `x-request-id` ignored), 16 KiB body limit → `PAYLOAD_TOO_LARGE`, malformed → `VALIDATION_FAILED`, unexpected → `INTERNAL` with no stack/SQL.
- Socket.IO attached at `/socket.io`, WebSocket-only, exact Origin allowlist, and **every handshake refused with `TICKET_INVALID`** until ticket issuance lands in phase 03.
- Web: `/` redirects to `/access`; game, auth and admin areas are feature-flagged and say they are unavailable (no fake flows).

## Migrations
None (phase 01 is "local Supabase config only").

## Checks actually run (all in this container)
| Command | Result |
|---|---|
| `pnpm lint` (ESLint + Prettier) | pass |
| `pnpm typecheck` | pass (5 packages + tests/scripts) |
| `pnpm contracts:check` | pass — 30 commands, 53 events, 67 error codes, 62 HTTP operations |
| `pnpm test:unit` | pass — 5 files, 31 tests |
| `pnpm build` | pass — Next.js production build (9 routes) + server bundle |
| `pnpm test:e2e` | pass — 8 tests (desktop 1440×900 + mobile 360×800), incl. axe WCAG 2.2 AA serious/critical = 0 |
| `pnpm dev` smoke | API `/health/live` 200, `/health/ready` 503 (no DB), web `/access` 200, `/` → 307 `/access` |
| `scripts/db/local-pg.sh start`, `pnpm db:reset`, `pnpm db:lint` | pass (0 migrations, 0 tables yet) |
| `pnpm test:load` | **fails by design** — no load profiles until phase 17 (script exits 1 rather than faking a pass) |
| `pnpm test:integration/security/concurrency` | not run — no test files yet (phase 02+) |

## Security checks
- Dependency-boundary test: web never imports `@stumps/game-engines`, server packages, `pg`, `argon2`, `socket.io`; browser-safe packages never import `node:*`; client components never import `env.server`; only `NEXT_PUBLIC_SOCKET_URL` is public; engines never read `Date.now`/`Math.random`. ESLint enforces the same rules.
- Env validation errors list names only, never values (tested with a secret-bearing URL).
- `.env.example` contains placeholders only.

## Known gaps / risks
- Node 22 used locally (ADR-016); production Node 24 verification deferred to phase 18.
- CI workflow is written but has not run on GitHub because pushes are blocked (HTTP 403).
- Fonts: system fallback until licensed self-hosted Inter is added (phase 04).

## Next phase
Phase 02 — Supabase foundation and catalog schema.
