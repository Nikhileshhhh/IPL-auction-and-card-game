# Phase 00 report — Freeze requirements and contracts

**Date:** 2026-10-09 · **Result:** complete (documentation and machine-readable contracts only; no application code, per the phase prompt).

## Changed paths
- `docs/spec/*` — the five STUMPS v1.0 specifications (unchanged copies of the supplied files).
- `docs/adr/001–015` — mirror master-plan ADR01–ADR15 as accepted decisions.
- `docs/adr/016-local-development-environment.md` — Node 22, plain PostgreSQL 16 with Supabase shim, local Auth/Storage adapters for dev/test only.
- `docs/adr/017-player-portraits-on-cards-and-auction.md` — product-owner requirement: portraits mandatory on all cards and auction lots.
- `docs/requirements-traceability.md` — 30 requirements, E01–E72, V01–V21, cross-workflow scenarios → phase/module/test.
- `docs/source-register.md`, `docs/toolchain.md`, `docs/migration-manifest.md` (migration order + retention class for all 72 tables), `docs/screens.md` (S01–S35 routes, hierarchy, data, phase).
- `docs/spec-review/phase-00-trace-review.md` — traces of four-card, six-card, exhaustion, exact-deadline bid, RTM and vote examples; decisions D1–D8.
- `packages/contracts/schema/{commands,events,error-codes,dto-catalog,http-operations,audiences}.json`.

## Migrations
None (design manifest only).

## Checks actually run
- Scratch consistency script (not committed; phase 01 adds `pnpm contracts:check`): internal Markdown links resolve; every command in DB §8.2 and every event in DB §8.3 exists in the JSON catalogs; every event a command emits is registered; every error code named in the DB spec is registered; E01–E72 and V01–V21 all appear in traceability; S01–S26 present with check dates. **Result: 0 failures** (after fixing two checker bugs; one real spec inconsistency found and recorded as D8).
- JSON validity of all six schema files: pass.

## Security boundaries confirmed (design)
Global gate grant (opaque cookie, 3-attempt bucket) → Supabase Auth session (BFF HttpOnly cookies) → room code + optional room password → franchise code + captain approval → admin DB assignment + AAL2 + step-up. Each boundary is enforced server-side per action (no route-guard-only authorization).

## Known gaps / risks
- GitHub push is blocked (HTTP 403: Claude GitHub App not installed / account not connected). Commits are local only.
- Supabase-specific behavior can only be verified in staging (ADR-016).
- Historical IPL preset values are not yet imported (source register release gate).

## Next phase
Phase 01 — Initialize runnable monorepo.
