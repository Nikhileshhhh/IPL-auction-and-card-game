# ADR-016: Local development and test environment deviations

- **Status:** Accepted for development/test only (does not change production architecture)
- **Date:** 9 October 2026

## Context
The build container provides Node 22.22.0, pnpm 10.28.0 and PostgreSQL 16 binaries, but no Docker daemon. The Supabase CLI local stack (GoTrue, Storage, Kong) requires Docker, and the spec's proposed runtime baseline is Node 24 LTS.

## Decision
1. **Runtime:** develop and test on Node 22 LTS (supported until April 2027). `engines.node` is `>=22.12`; production deployment (phase 18) re-verifies Node 24 LTS and pins it in `render.yaml`. No code uses Node-24-only APIs.
2. **Database:** integration, security and concurrency tests run against a real PostgreSQL 16 cluster started by `scripts/db/local-pg.sh`. Migration `000` creates a minimal Supabase-compatible shim (`auth` schema with `auth.users`, roles `anon`, `authenticated`, `service_role`) **only when those objects do not already exist**, so the same migrations apply unchanged to a real Supabase project.
3. **Auth provider adapter:** the server talks to Auth through an `AuthProvider` interface. `SupabaseAuthProvider` is the production implementation. `LocalAuthProvider` (Argon2id hashes in a dev-only `auth_local` schema, HS256 JWTs, TOTP MFA via RFC 6238) exists so the whole product can run and be tested without Supabase. It refuses to start when `NODE_ENV=production` or when `AUTH_PROVIDER` is not explicitly `local`.
4. **Storage adapter:** `StorageProvider` interface with `SupabaseStorageProvider` (production) and `LocalFsStorageProvider` (dev/test, private directory outside `public/`, signed short-lived read URLs served by the API).

## Consequences
- Tests exercise real PostgreSQL locking, RLS and grants, as the spec requires.
- Supabase-specific behavior (GoTrue invite emails, provider MFA factors, Storage API) is verified only in staging (phase 18); this gap is reported in each phase report rather than claimed as tested.
