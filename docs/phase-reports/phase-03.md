# Phase 03 report — Global gate, Auth and administration access

**Date:** 2026-10-09 · **Result:** complete for the local stack; Supabase-hosted Auth paths verified only by unit tests (see gaps).

## Changed paths (main)
- Migration `035_access_auth` (admin MFA enrollment window + column-level grant, `rate_counters`, `access_config.rotated_at`); dev-only `supabase/local/001_auth_local.sql` (LocalAuthProvider storage, never applied to real environments).
- Server: `modules/access-gate/service.ts`, `modules/auth/{provider,service,local-provider,supabase-provider}.ts`, `modules/admin/service.ts`, `modules/profiles/onboarding.ts`, `modules/security/rate-limit.ts`, `http/{ingress,bff-directives,validation}.ts`, `security/{crypto,password-hash}.ts`, `config/secrets.ts`, `realtime/{tickets,security-bus,gateway}.ts`, `jobs/security-cleanup.ts`, `routes/v1/{access,auth,profiles,admin,realtime}.ts`, `db/rows.ts`.
- Contracts: `auth.ts` (gate/auth/onboarding/rotation DTOs), `ingress.ts` (canonical signed-ingress string).
- Web: `lib/bff/*` (signing, HttpOnly cookies, CSRF, directives, server session), `app/api/v1/[...path]/route.ts` (BFF proxy), `app/api/session/csrf/route.ts`, `proxy.ts`, screens `/access` (S01), `/auth`, `/auth/callback`, `/auth/reset` (S02), `/onboarding` (S03), `/admin/login` (S32), `/admin` (access rotation), `(member)` layout with server-side session check; `packages/ui` primitives (Button, TextField, PasswordField, StatusMessage).
- Scripts: `ops:set-access-code`, `ops:bootstrap-admin` (now opens a 1-hour MFA enrollment window), `setup:env`, `dev:mailbox`.

## Behavior
- **Gate:** 256-bit attempt cookie; exactly 3 failures per bucket locks immediately for the configured lockout; a correct code while locked does not unlock; refresh/tabs share the bucket; retried request IDs replay the stored outcome without another comparison (a successful replay re-binds the same grant); cheap per-IP limit (30/15 min) before hashing; Argon2id (19 MiB, t=2, p=1) over an HMAC pepper, hashing concurrency bounded; gate fail-closed until an operator sets the first code.
- **Grants:** opaque preauth (10 min) → rotated bound grant at sign-in (12 h, 2 h idle, never beyond code expiry); every member request re-checks grant version ≥ `min_valid_version`, session, ban.
- **Rotation:** admin + AAL2 + step-up ≤5 min, optimistic version check, REVOKE_EXISTING (default) revokes all grants and disconnects affected sockets; PRESERVE_EXISTING keeps them; generated 128-bit option shown once; audit without the code.
- **Auth:** closed enrollment (gate required, generic response, email rate limits); invitation callback requires Auth's single-use token + the pending enrollment nonce + same email hash + current gate version + a gate grant in this browser; password setup; recovery; refresh single-flight (E71); logout revokes server-side sessions.
- **BFF:** exact Origin + session-bound CSRF on every mutation; credentials only in HttpOnly SameSite=Lax cookies (`__Host-` on HTTPS); HMAC-signed ingress (method, path, timestamp ±60 s, nonce replay cache, client IP, origin, body hash, credential hash); API tokens never appear in browser JSON.
- **Admin:** separate admin session (30 min idle, 8 h absolute), DB assignment checked per call (no JWT metadata), AAL2 required, TOTP enrollment only inside the operator-opened window.
- **Socket tickets:** one-use, 30 s, origin-bound, consumed atomically with session/grant/ban re-verification.

## Checks actually run
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass |
| `pnpm test:unit` | pass — 42 tests |
| `pnpm build` | pass |
| `pnpm db:reset` / `pnpm db:lint` | pass — 5 migrations, 36 tables |
| `pnpm test:integration` | pass — 36 tests (incl. initial access code script) |
| `pnpm test:security` | pass — 38 tests |
| `pnpm test:e2e` | pass — 24 tests (desktop + 360 px mobile), axe serious/critical = 0 |
| Dev smoke (`setup:env`, `db:reset`, `ops:set-access-code`, `pnpm dev`) | readiness 200; BFF sets HttpOnly attempt cookie; unsigned direct API call 403 |

## Security / failure cases verified (named tests)
Concurrent third/fourth failures across two tabs (exactly 3 evaluated), correct code racing failures, lockout persistence, replayed request IDs, rotation modes, enrollment generic response, invite callback replay, cross-email nonce swap, stale invite after revoke, valid JWT without gate (E03), grant bound to another user, self-signed/metadata-forged JWT, generic bad credentials, logout revocation, concurrent refresh single-flight (E71), suspension, reserved/taken usernames, mass-assignment of counters/roles, unsigned/tampered/stale/replayed/IP-spoofed BFF requests, non-admin admin login, AAL1/MFA bypass, enrollment outside window, wrong TOTP, rotation version conflict, step-up expiry, revoked admin, admin idle timeout, stolen/expired/wrong-origin socket tickets, revocation disconnects live sockets, TTL sweep.

## Bugs found and fixed during this phase
- Tailwind v4 theme colour `base` collided with the `text-base` size utility, making danger-button text unreadable (caught by axe in e2e); token renamed to `midnight`.
- Runtime role could not close the MFA enrollment window (INTERNAL during verification); fixed with a column-level grant.

## Known gaps / risks
- `SupabaseAuthProvider` sign-in, invite, recovery and MFA calls are implemented against the documented SDK but **not executed against a real Supabase project** (no project/credentials in this environment); JWT verification is unit-tested with local ES256 keys. Staging verification is a phase-18 gate.
- Nonce replay cache is per process (acceptable for one instance; ADR-014 applies when scaling).
- GitHub push still blocked (HTTP 403).

## Next phase
Phase 04 — Design system and dashboard.
