# Phase 02 report — Supabase foundation and catalog schema

**Date:** 2026-10-09 · **Result:** complete.

## Migrations (IDs)
| ID | Contents |
|---|---|
| `000_extensions_roles_schema` | pgcrypto; Supabase shim (roles `anon`/`authenticated`/`service_role`, `auth.users`) created **only if absent**; `app_runtime` (LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT); `app_private` schema with PUBLIC/browser revokes and default-privilege revokes; `app_meta.schema_migrations`; `touch_updated_at()` |
| `010_profiles_security` | profiles, admin_assignments, app_config, access_config (fail-closed singleton), access_attempts, gate_grants, access_request_receipts, enrollment_invites, app_sessions, socket_tickets, request_receipts, security_events, admin_audit, runtime_leases, announcements |
| `020_catalog` | data_sources, seasons, media_assets, franchises, season_franchises, players, player_external_ids, data_versions, player_seasons (per version, portrait), player_statistics, player_ratings, card_definitions, card_players, auction_rulesets, auction_pool_entries; immutability triggers; deferred dual-card player-count trigger |
| `030_social_achievements` | friendships, user_blocks, notifications, achievement_receipts (append-only), achievement_summaries |

All 35 tables: RLS enabled **and forced**, one `backend_runtime` policy scoped to `app_runtime`, explicit least-privilege grants, every FK indexed, every table classified in `docs/migration-manifest.md` (deviations from the spec dictionary are listed there).

## Code
- `apps/server/src/db/transaction.ts` — `withTransaction` (isolation, `SET LOCAL` statement/lock timeouts via `set_config(..., true)`, ≤3 jittered retries on `40001`/`40P01`, fail-closed `SERVICE_UNAVAILABLE` for lock timeout/connection loss) and `dbNow` (DB `clock_timestamp()`).
- `apps/server/src/db/schema-version.ts` — readiness `schema` check (database must be at least `030_social_achievements`).
- `apps/server/src/modules/auth/*` — `AuthProvider` boundary; `SupabaseAuthProvider` verifies asymmetric JWTs against a **pinned** issuer/JWKS (ES256/RS256 only, audience `authenticated`, role `authenticated`, `session_id`, `aal`); `LocalAuthProvider` (HS256, dev/test only, refuses production). Identity carries no roles; metadata flags are ignored.
- `packages/contracts/src/auth.ts` — gate/auth/onboarding/session DTOs, username/password/email policies.
- `scripts/bootstrap-admin/{assign,index}.ts` — operator-only admin assignment (verified email + enrolled profile, first admin must be super_admin, later admins require approval by an existing super_admin, advisory-locked, audited).
- `tests/support/{db,global-setup}.ts` — real PostgreSQL helpers; integration projects auto-start the local cluster.
- CI: new `database` job with a PostgreSQL 16 service running `db:reset`, `db:lint`, `test:integration`.

## Checks actually run
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass |
| `pnpm test:unit` | pass — 7 files, 42 tests (incl. JWT verification and secret scan) |
| `pnpm build` | pass |
| `pnpm db:reset` | pass — 4 migrations |
| `pnpm db:lint` | pass — 35 tables |
| `pnpm test:integration` | pass — 4 files, 34 tests on real PostgreSQL 16 |

## Security / failure cases verified
- Fresh reset; **upgrade from the 010 baseline** with existing data produces a schema fingerprint identical to a fresh reset; re-apply is a no-op; edited applied migration is refused.
- `anon` and `authenticated` get `42501` on SELECT/DELETE for **every** `app_private` table; no schema USAGE.
- `app_runtime`: no DDL (`app_private`, `public`), cannot disable RLS/drop tables, cannot read `auth.users`, cannot insert/update `admin_assignments`, cannot update/delete receipts; a role with grants but no policy sees zero rows (RLS is actually enforced).
- Constraint tests: username format + case-insensitive uniqueness, canonical friendship pairs requested by an endpoint, self-block, receipt uniqueness per award batch + medal↔place mapping + `medal ⇒ qualifies` + card receipts personal-only, gate grant kind/user consistency, socket ticket ≤30 s, `max_failures = 3`, singleton `access_config`, account-erasure cascade, published-version immutability (rows, version metadata, delete), archive-only transition, dual/single card player counts at commit, media key traversal and SVG rejection.
- A real deadlock between two transactions is retried and both commit exactly once; a held row lock surfaces `SERVICE_UNAVAILABLE` (`lock_timeout`) instead of hanging; unreachable DB fails closed.
- Admin bootstrap: unverified email / no profile refused; first admin must be super_admin; second requires approval; **two concurrent bootstrap attempts produce exactly one super admin**.
- Secret scan: no private keys, JWTs, provider secret keys or non-placeholder DB passwords in tracked files.

## Known gaps / risks
- Bug found and fixed during this phase: PL/pgSQL triggers referenced record fields that do not exist on the other trigger table (would have broken every card definition insert).
- Supabase-hosted behaviors (real GoTrue JWKS, `auth.users` managed by GoTrue) are verified only in staging (ADR-016).
- GitHub push still blocked (HTTP 403); CI has not run remotely.

## Next phase
Phase 03 — Global gate, Auth and administration access.
