# Codex Implementation Prompts

**STUMPS v1.0 • 9 October 2026.** Execute sequentially against one repository. This is a build roadmap, not evidence that any phase is implemented. The master plan is the product authority; game rules, architecture and UI companions provide normative detail. Never invent contradictory defaults. If a discovered source changes a rule, record an ADR and update all affected specifications before implementation.

## Shared execution contract

The following contract is incorporated into every copy-ready task below. Copy it together with the chosen phase prompt if the implementing conversation does not already contain these files.

```text
Read AGENTS.md and inspect the repository, package scripts, current git changes,
existing migrations and the five STUMPS v1.0 specification documents before editing.
Do not overwrite unrelated user work. Reuse established modules and conventions.
Use Next.js/React/TypeScript/Tailwind/shadcn/ui/Motion on Vercel, Fastify/Node/Socket.IO
on Render, and Supabase Auth/PostgreSQL/Storage. PostgreSQL is authoritative.
Follow the selected architecture and explicit decisions; do not choose a new stack.
Use strict TypeScript, shared Zod contracts, parameterized SQL and typed errors.
Validate every untrusted input and authorize the current actor/resource/action.
Never trust role, budget, deck, rating, outcome, score, vote count or medal from a client.
Do not expose server keys, plaintext codes, passwords, refresh tokens or private state.
For schema changes create versioned SQL migrations with RLS/grants, same-room FKs,
constraints/indexes, retention classification and local upgrade/reset verification.
Keep pure game reducers separate from IO, clock access and UI. Pass server time and
frozen rules explicitly; no Date.now/random calls hidden inside a pure reducer.
All gameplay writes use the room transaction wrapper, idempotency and durable events.
Write meaningful tests for the new invariants and failure cases. Use real PostgreSQL
for locking and RLS. Do not add shallow tests only mirroring the implementation.
Run existing relevant checks; fix failures introduced by the change. Do not claim a
check passed if not run. Report environmental blockers and untested behavior plainly.
Keep the repo runnable after this phase. Feature-flag incomplete game entry points;
never fake success to make a demo look finished. Update requirement traceability.
Finish with changed files, behavior, migrations, commands actually run, results,
remaining risks/blockers and next permitted phase. Do not auto-publish or run
production data migrations unless that deployment action is authorized in context.
```

## Required scripts and conventions

Phase 1 must define these scripts once: `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:security`, `pnpm test:concurrency`, `pnpm test:e2e`, `pnpm test:load`, `pnpm build`, `pnpm db:reset`, `pnpm db:lint`, `pnpm contracts:check`. Use Vitest for unit/integration, fast-check for property tests, Playwright for browser E2E, axe for automated accessibility checks and a Node Socket.IO load harness for actual Socket.IO protocol clients. Do not use a plain WebSocket load client against Socket.IO without implementing its protocol.

Dependencies: Next.js/React matched supported versions, TypeScript, Fastify, Socket.IO server/client of compatible major versions, Zod, pg, Supabase SSR/JS SDKs, Argon2, Tailwind, shadcn/Radix primitives, `motion`, TanStack Query, Zustand, Vitest, fast-check, Playwright, axe, ESLint, Prettier, Pino. Node24 LTS is the proposed baseline; verify support and patched versions in phase 0, pin exact versions in pnpm-lock.yaml and toolchain notes. No requirement depends on a beta API. Shared packages export browser-safe DTOs/UI separately from server-only game engine/database code. Use one validation library and one animation library.

## Milestones and effort assumptions

M0 (phases0–5): private authenticated lobby with recovery primitives. M1 (6–8): fully defined playable card engine, with final medal/cleanup flow still an explicit gap. M2 (9–12): auction and mandatory multi-user/auto control complete, with results/social still incomplete. M3 (13–15): minimum complete platform—both games end, eligible users receive medals, friends persist, and room data is deleted. M4 (16–19): full premium experience, production qualification and operations. No milestone before M3 is advertised as satisfying the complete request.

Planning range, not commitment: an experienced small team using Codex should budget roughly12–20 engineer-weeks for a reliable pilot and another4–8 for visual/data/operational hardening, with parallel human disciplines where available. One developer may take3–6 months or more; rights acquisition and data cleanup are external schedule risks. AI-generated code does not remove concurrency/security review. Phase 0–3 and7–15 are high-risk correctness work; do not compress them to make a cosmetic demo deadline.

## Phase 00 — Freeze requirements and contracts

**Objective:** Convert the five specifications into versioned repository decisions and machine-readable contracts without implementing the application.

**Prerequisites and dependencies:** Phase(s) none; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** docs/spec/*; docs/adr/001-012.md; docs/requirements-traceability.md; docs/source-register.md; docs/toolchain.md; packages/contracts/schema/*

**Database changes:** Design migration manifest and retention ownership map only; no production DB writes.

**API and realtime changes:** Name command/event enums, DTO schemas, errors, audience projections and version behavior.

**Frontend work:** Document S01–S35 navigation and component contracts before UI implementation.

**Security checks:** Confirm every boundary: global grant/Auth/room password/team approval/admin MFA.

**Tests and verification:** Review four/six-card examples, exact-deadline bid, RTM and vote traces against invariants.

**Definition of done:** Every mandatory requirement maps to a phase, module and acceptance test; source limitations and proposed rules are explicit.

**Common implementation mistakes:** Calling historical settings current; undocumented policy changes; choosing different architecture per task.

### Copy-ready phase task

```text
Implement STUMPS phase 00: Freeze requirements and contracts.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): none.

Objective and features:
Convert the five specifications into versioned repository decisions and machine-readable contracts without implementing the application.

Inspect existing modules, then create/update these paths only as needed:
docs/spec/*; docs/adr/001-012.md; docs/requirements-traceability.md; docs/source-register.md; docs/toolchain.md; packages/contracts/schema/*

Database work (use migrations, policies, constraints and retention rules):
Design migration manifest and retention ownership map only; no production DB writes.

Transport contract and backend work:
Name command/event enums, DTO schemas, errors, audience projections and version behavior.

UI work after the relevant contract is established:
Document S01–S35 navigation and component contracts before UI implementation.

Security and fairness acceptance:
Confirm every boundary: global grant/Auth/room password/team approval/admin MFA.

Required tests and failure scenarios:
Review four/six-card examples, exact-deadline bid, RTM and vote traces against invariants.

Run applicable repository checks individually and inspect every result:
Check internal links, requirement mappings, schema/event name consistency and source dates; do not pretend application tests exist.
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Calling historical settings current; undocumented policy changes; choosing different architecture per task.

This phase is done only when:
Every mandatory requirement maps to a phase, module and acceptance test; source limitations and proposed rules are explicit.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 01 — Initialize runnable monorepo

**Objective:** Set up strict TypeScript, apps, shared packages, test infrastructure and health-only backend.

**Prerequisites and dependencies:** Phase(s) 0; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** package.json; pnpm-workspace.yaml; apps/web/*; apps/server/src/{app, main}.ts; packages/contracts; packages/ui; packages/game-engines; eslint.config.*; .github/workflows/ci.yml; .env.example

**Database changes:** Local Supabase config only; bootstrap no application tables yet.

**API and realtime changes:** GET /health/live and /health/ready; explicit versioned API prefix and shared error envelope.

**Frontend work:** Empty branded shell, navigation routes and ErrorBoundary using established contracts.

**Security checks:** server-only imports; env validation; secrets excluded from NEXT_PUBLIC and logs.

**Tests and verification:** Lint/typecheck/build; smoke health endpoints; dependency boundary test rejects server package imports into web.

**Definition of done:** pnpm dev starts both apps; CI lint/typecheck/test/build succeeds with no real credentials.

**Common implementation mistakes:** Installing two animation libraries; unpinned lockfile; hardcoded secrets; treating health200 as game readiness.

### Copy-ready phase task

```text
Implement STUMPS phase 01: Initialize runnable monorepo.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 0.

Objective and features:
Set up strict TypeScript, apps, shared packages, test infrastructure and health-only backend.

Inspect existing modules, then create/update these paths only as needed:
package.json; pnpm-workspace.yaml; apps/web/*; apps/server/src/{app,main}.ts; packages/contracts; packages/ui; packages/game-engines; eslint.config.*; .github/workflows/ci.yml; .env.example

Database work (use migrations, policies, constraints and retention rules):
Local Supabase config only; bootstrap no application tables yet.

Transport contract and backend work:
GET /health/live and /health/ready; explicit versioned API prefix and shared error envelope.

UI work after the relevant contract is established:
Empty branded shell, navigation routes and ErrorBoundary using established contracts.

Security and fairness acceptance:
server-only imports; env validation; secrets excluded from NEXT_PUBLIC and logs.

Required tests and failure scenarios:
Lint/typecheck/build; smoke health endpoints; dependency boundary test rejects server package imports into web.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Installing two animation libraries; unpinned lockfile; hardcoded secrets; treating health200 as game readiness.

This phase is done only when:
pnpm dev starts both apps; CI lint/typecheck/test/build succeeds with no real credentials.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 02 — Supabase foundation and catalog schema

**Objective:** Create core schema, grants, profile/security entities and local migrations.

**Prerequisites and dependencies:** Phase(s) 1; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** supabase/migrations/000*–030*; apps/server/src/db/*; apps/server/src/modules/auth/*; packages/contracts/auth.ts; tests/integration/rls.spec.ts

**Database changes:** Profiles, admin assignments, gate/enrollment/session tables, catalog sources and versions, social+achievement roots; FORCE RLS and grants.

**API and realtime changes:** Auth/gate DTOs only; Auth SDK adapter; DB transaction helper with timeout and retry policy.

**Frontend work:** No new game UI; developer setup instructions for local Supabase.

**Security checks:** Browser roles denied; app_runtime no DDL/BYPASSRLS; separate migration credentials; admin bootstrap protected.

**Tests and verification:** Fresh reset; migrate from prior baseline; anon/authenticated denial; FK/cross-user tests; secret scan.

**Definition of done:** Empty DB reaches expected schema; every created table has classified retention, RLS and grants.

**Common implementation mistakes:** Using service role everywhere; postponing table security until final phase; editing provider auth tables directly.

### Copy-ready phase task

```text
Implement STUMPS phase 02: Supabase foundation and catalog schema.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 1.

Objective and features:
Create core schema, grants, profile/security entities and local migrations.

Inspect existing modules, then create/update these paths only as needed:
supabase/migrations/000*–030*; apps/server/src/db/*; apps/server/src/modules/auth/*; packages/contracts/auth.ts; tests/integration/rls.spec.ts

Database work (use migrations, policies, constraints and retention rules):
Profiles,admin assignments,gate/enrollment/session tables,catalog sources and versions,social+achievement roots; FORCE RLS and grants.

Transport contract and backend work:
Auth/gate DTOs only; Auth SDK adapter; DB transaction helper with timeout and retry policy.

UI work after the relevant contract is established:
No new game UI; developer setup instructions for local Supabase.

Security and fairness acceptance:
Browser roles denied; app_runtime no DDL/BYPASSRLS; separate migration credentials; admin bootstrap protected.

Required tests and failure scenarios:
Fresh reset; migrate from prior baseline; anon/authenticated denial; FK/cross-user tests; secret scan.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Using service role everywhere; postponing table security until final phase; editing provider auth tables directly.

This phase is done only when:
Empty DB reaches expected schema; every created table has classified retention,RLS and grants.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 03 — Global gate, Auth and administration access

**Objective:** Implement exactly three failed attempts per protected bucket, rotation, invitation enrollment, login and MFA admin session.

**Prerequisites and dependencies:** Phase(s) 2; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/web/app/(public)/{access, auth}/*; apps/web/app/admin/login/*; apps/web/app/api/*; apps/server/src/modules/{access-gate, auth, admin}/*; packages/contracts/security.ts

**Database changes:** Complete access/session/attempt and audited rotation migrations; TTL indexes and cleanup.

**API and realtime changes:** /access/*,/auth/*,/admin/auth/*,/admin/access,/socket-tickets; same-origin BFF and signed ingress metadata.

**Frontend work:** AccessGate, AuthForm, OnboardingForm, AdminLogin; persistent lockout/remaining-attempt states.

**Security checks:** Argon2id+pepper; HttpOnly cookies; CSRF+Origin; AAL2; closed signup; direct API denial despite valid JWT without gate.

**Tests and verification:** Concurrent third failures; refresh/tabs; code rotation modes; stolen ticket reuse; fake role; invite callback replay; MFA bypass.

**Definition of done:** A new invited user can onboard; invalid/revoked gate cannot access data; admin rotates secret securely.

**Common implementation mistakes:** Claiming per-human anonymous enforcement; logging passwords; relying on Next route guard alone; infinite Auth refresh races.

### Copy-ready phase task

```text
Implement STUMPS phase 03: Global gate, Auth and administration access.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 2.

Objective and features:
Implement exactly three failed attempts per protected bucket, rotation, invitation enrollment, login and MFA admin session.

Inspect existing modules, then create/update these paths only as needed:
apps/web/app/(public)/{access,auth}/*; apps/web/app/admin/login/*; apps/web/app/api/*; apps/server/src/modules/{access-gate,auth,admin}/*; packages/contracts/security.ts

Database work (use migrations, policies, constraints and retention rules):
Complete access/session/attempt and audited rotation migrations; TTL indexes and cleanup.

Transport contract and backend work:
/access/*,/auth/*,/admin/auth/*,/admin/access,/socket-tickets; same-origin BFF and signed ingress metadata.

UI work after the relevant contract is established:
AccessGate,AuthForm,OnboardingForm,AdminLogin; persistent lockout/remaining-attempt states.

Security and fairness acceptance:
Argon2id+pepper; HttpOnly cookies; CSRF+Origin; AAL2; closed signup; direct API denial despite valid JWT without gate.

Required tests and failure scenarios:
Concurrent third failures; refresh/tabs; code rotation modes; stolen ticket reuse; fake role; invite callback replay; MFA bypass.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Claiming per-human anonymous enforcement; logging passwords; relying on Next route guard alone; infinite Auth refresh races.

This phase is done only when:
A new invited user can onboard; invalid/revoked gate cannot access data; admin rotates secret securely.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 04 — Design system and dashboard

**Objective:** Build tokens, accessible primitives, game selection and profile shell from frozen contracts.

**Prerequisites and dependencies:** Phase(s) 3; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/ui/src/{tokens, button, dialog, card, status}/*; apps/web/app/(member)/play/*; apps/web/components/game-selection/*; docs/visual-checklist.md

**Database changes:** No critical schema change; announcements read projection if required.

**API and realtime changes:** GET own session/profile summary and active announcements with no-store caching.

**Frontend work:** S04 and shared shell, GameSelectionCard, MedalBadge, ConnectionBoundary, skeleton/error states.

**Security checks:** No private assets in public bucket; no fabricated achievements; remote image allowlist.

**Tests and verification:** Keyboard/axe/token contrast; desktop/mobile/200%zoom screenshots; private route redirect and stale gate test.

**Definition of done:** Both game entry points work, with licensed/fallback visuals and responsive design review.

**Common implementation mistakes:** Building a generic admin dashboard as the game home; heavy looping effects; optimistic medal counts.

### Copy-ready phase task

```text
Implement STUMPS phase 04: Design system and dashboard.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 3.

Objective and features:
Build tokens, accessible primitives, game selection and profile shell from frozen contracts.

Inspect existing modules, then create/update these paths only as needed:
packages/ui/src/{tokens,button,dialog,card,status}/*; apps/web/app/(member)/play/*; apps/web/components/game-selection/*; docs/visual-checklist.md

Database work (use migrations, policies, constraints and retention rules):
No critical schema change; announcements read projection if required.

Transport contract and backend work:
GET own session/profile summary and active announcements with no-store caching.

UI work after the relevant contract is established:
S04 andshared shell,GameSelectionCard,MedalBadge,ConnectionBoundary,skeleton/error states.

Security and fairness acceptance:
No private assets in public bucket; no fabricated achievements; remote image allowlist.

Required tests and failure scenarios:
Keyboard/axe/token contrast; desktop/mobile/200%zoom screenshots; private route redirect and stale gate test.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Building a generic admin dashboard as the game home; heavy looping effects; optimistic medal counts.

This phase is done only when:
Both game entry points work, with licensed/fallback visuals and responsive design review.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 05 — Rooms, realtime and durable infrastructure

**Objective:** Implement generated-code rooms, lobby readiness, host lifecycle, command receipts, streams and deadline framework.

**Prerequisites and dependencies:** Phase(s) 4; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/{rooms, presence, deadlines}/*; apps/server/src/realtime/*; apps/server/src/jobs/*; apps/web/features/room/*; packages/contracts/rooms.ts

**Database changes:** rooms, members, invites, connections, commands, streams, events, deadline_jobs, runtime_leases; composite same-room FKs.

**API and realtime changes:** Create/join/leave/ready/settings/start stub gates, host transfer, ticket connect, snapshot/replay; room and presence events.

**Frontend work:** S05–S07, S14–S17 lobby shells, RoomCreationDialog, RoomJoinDialog, MultiplayerLobby.

**Security checks:** Cryptographic12-char codes; password separate; max capacity under lock; duplicate tabs read-only; no browser writes.

**Tests and verification:** Two joiners last slot; wrong password; host dropout; duplicate command; unauthorized stream; replay gap; restart lease.

**Definition of done:** Two real browser contexts join with same authoritative lobby; start requires ready config; snapshots survive restart.

**Common implementation mistakes:** In-memory-only rooms; hardcoded user seat; Socket.IO channel name as authorization; child-before-room lock order.

### Copy-ready phase task

```text
Implement STUMPS phase 05: Rooms, realtime and durable infrastructure.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 4.

Objective and features:
Implement generated-code rooms, lobby readiness, host lifecycle, command receipts, streams and deadline framework.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/{rooms,presence,deadlines}/*; apps/server/src/realtime/*; apps/server/src/jobs/*; apps/web/features/room/*; packages/contracts/rooms.ts

Database work (use migrations, policies, constraints and retention rules):
rooms,members,invites,connections,commands,streams,events,deadline_jobs,runtime_leases; composite same-room FKs.

Transport contract and backend work:
Create/join/leave/ready/settings/start stub gates,host transfer,ticket connect,snapshot/replay; room and presence events.

UI work after the relevant contract is established:
S05–S07,S14–S17 lobby shells,RoomCreationDialog,RoomJoinDialog,MultiplayerLobby.

Security and fairness acceptance:
Cryptographic12-char codes; password separate; max capacity under lock; duplicate tabs read-only; no browser writes.

Required tests and failure scenarios:
Two joiners last slot; wrong password; host dropout; duplicate command; unauthorized stream; replay gap; restart lease.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security; pnpm test:concurrency
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
In-memory-only rooms; hardcoded user seat; Socket.IO channel name as authorization; child-before-room lock order.

This phase is done only when:
Two real browser contexts join with same authoritative lobby; start requires ready config; snapshots survive restart.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 06 — Cricket data, original cards and admin publishing

**Objective:** Implement reviewed import/version pipeline, synthetic demo fixtures, rating computation, rarity and six card renderers.

**Prerequisites and dependencies:** Phase(s) 5; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/cricket-data/*; apps/server/src/modules/admin/catalog/*; packages/game-engines/src/ratings/*; apps/web/components/cards/*; supabase/seed/*; tests/fixtures/data/*

**Database changes:** Complete sources/statistics/ratings/media/card tables; immutable published versions and rights metadata.

**API and realtime changes:** Admin import/draft/validate/publish/archive; permitted catalog reads.

**Frontend work:** S08 preview, S10 card detail, S34 data editor; Normal through Dual Platinum variants.

**Security checks:** No arbitrary URL fetch; sanitize image uploads; prohibit published edits; source/provenance required.

**Tests and verification:** Rating determinism, missing/zero distinction, role stars, dual normalization, rare pool insufficiency; six visual variants.

**Definition of done:** A reproducible40+fictional-player fixture and configurable larger pool publish; no fake official data; cards readable mobile.

**Common implementation mistakes:** Fame-based stars; rarity multiplier; copying official images; latest data leaking into historical simulation.

### Copy-ready phase task

```text
Implement STUMPS phase 06: Cricket data, original cards and admin publishing.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 5.

Objective and features:
Implement reviewed import/version pipeline, synthetic demo fixtures, rating computation, rarity and six card renderers.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/cricket-data/*; apps/server/src/modules/admin/catalog/*; packages/game-engines/src/ratings/*; apps/web/components/cards/*; supabase/seed/*; tests/fixtures/data/*

Database work (use migrations, policies, constraints and retention rules):
Complete sources/statistics/ratings/media/card tables; immutable published versions and rights metadata.

Transport contract and backend work:
Admin import/draft/validate/publish/archive; permitted catalog reads.

UI work after the relevant contract is established:
S08 preview,S10 card detail,S34 data editor; Normal through Dual Platinum variants.

Security and fairness acceptance:
No arbitrary URL fetch; sanitize image uploads; prohibit published edits; source/provenance required.

Required tests and failure scenarios:
Rating determinism,missing/zero distinction,role stars,dual normalization,rare pool insufficiency; six visual variants.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Fame-based stars; rarity multiplier; copying official images; latest data leaking into historical simulation.

This phase is done only when:
A reproducible40+fictional-player fixture and configurable larger pool publish; no fake official data; cards readable mobile.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 07 — Authoritative card engine

**Objective:** Implement setup, committed randomness, fair deal, normal comparisons, ownership, timeout policy and elimination boundaries.

**Prerequisites and dependencies:** Phase(s) 6; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/game-engines/src/card/{types, rng, deal, reduce, invariants}.ts; apps/server/src/modules/cards/*; apps/web/features/cards/arena/*; tests/property/card-conservation.spec.ts

**Database changes:** card_games, seats, instances, comparisons, contributions, cycle_counts; location checks and deferred invariants.

**API and realtime changes:** card.selectCategory; roundOpened, comparisonResolved, potChanged; no browser award/deal methods.

**Frontend work:** S08–S10, S12; card reveal and selector controls bound to canonical room store.

**Security checks:** No future deck to clients; category+actor+phase checked; fixed-point ratings; deterministic retries.

**Tests and verification:** Four-player unique win; equal deal; duplicate definitions/constituents; unauthorized selector; kill before/after commit; conservation property.

**Definition of done:** A normal-round match runs from lobby to terminal engine state; medals/finalization stay feature-flagged until phase 14.

**Common implementation mistakes:** Client card selection; dropping cards on disconnect; animations blocking reducer; premature zero-card elimination.

### Copy-ready phase task

```text
Implement STUMPS phase 07: Authoritative card engine.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 6.

Objective and features:
Implement setup,committed randomness,fair deal,normal comparisons,ownership,timeout policy and elimination boundaries.

Inspect existing modules, then create/update these paths only as needed:
packages/game-engines/src/card/{types,rng,deal,reduce,invariants}.ts; apps/server/src/modules/cards/*; apps/web/features/cards/arena/*; tests/property/card-conservation.spec.ts

Database work (use migrations, policies, constraints and retention rules):
card_games,seats,instances,comparisons,contributions,cycle_counts; location checks and deferred invariants.

Transport contract and backend work:
card.selectCategory; roundOpened,comparisonResolved,potChanged; no browser award/deal methods.

UI work after the relevant contract is established:
S08–S10,S12; card reveal and selector controls bound to canonical room store.

Security and fairness acceptance:
No future deck to clients; category+actor+phase checked; fixed-point ratings; deterministic retries.

Required tests and failure scenarios:
Four-player unique win; equal deal; duplicate definitions/constituents; unauthorized selector; kill before/after commit; conservation property.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Client card selection; dropping cards on disconnect; animations blocking reducer; premature zero-card elimination.

This phase is done only when:
A normal-round match runs from lobby to terminal engine state; medals/finalization stay feature-flagged until phase14.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 08 — Complete tie engine and card termination

**Objective:** Implement all tie narrowing, exhaustion, fallback, cycle/time endings, rank ordering and reversible unresolved chains.

**Prerequisites and dependencies:** Phase(s) 7; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/game-engines/src/card/{ties, ranking, termination}.ts; apps/server/src/modules/cards/tie-service.ts; apps/web/features/cards/tie-arena/*; tests/fixtures/cards/*

**Database changes:** Tie metadata, cycle hash counts and elimination ranking constraints if not already in phase 7.

**API and realtime changes:** Tie reason codes, eligible/temporarily-ineligible projections, finishPending; internal fallback only.

**Frontend work:** S11 and detailed pot history; explain proposed fallback visibly.

**Security checks:** No re-entry by losing seat; seed only revealed after terminal state; stateVersion fences tie actions.

**Tests and verification:** Exact six-card example;2/3/4-way repeated ties; all exhausted; one able; last-card winner; restoration after vote; cycle cap.

**Definition of done:** Property and fixture tests prove every configured tie path terminates or advances with N conserved; podium stable.

**Common implementation mistakes:** Giving pot to a non-tied player; considering rarity as an automatic win; ranking all losers by final zero count.

### Copy-ready phase task

```text
Implement STUMPS phase 08: Complete tie engine and card termination.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 7.

Objective and features:
Implement all tie narrowing,exhaustion,fallback,cycle/time endings,rank ordering and reversible unresolved chains.

Inspect existing modules, then create/update these paths only as needed:
packages/game-engines/src/card/{ties,ranking,termination}.ts; apps/server/src/modules/cards/tie-service.ts; apps/web/features/cards/tie-arena/*; tests/fixtures/cards/*

Database work (use migrations, policies, constraints and retention rules):
Tie metadata,cycle hash counts and elimination ranking constraints if not already in phase7.

Transport contract and backend work:
Tie reason codes,eligible/temporarily-ineligible projections,finishPending; internal fallback only.

UI work after the relevant contract is established:
S11 and detailed pot history; explain proposed fallback visibly.

Security and fairness acceptance:
No re-entry by losing seat; seed only revealed after terminal state; stateVersion fences tie actions.

Required tests and failure scenarios:
Exact six-card example;2/3/4-way repeated ties;all exhausted;one able;last-card winner;restoration after vote;cycle cap.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Giving pot to a non-tied player; considering rarity as an automatic win; ranking all losers by final zero count.

This phase is done only when:
Property and fixture tests prove every configured tie path terminates or advances with N conserved; podium stable.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 09 — Auction rules, franchise foundation and retentions

**Objective:** Implement published historical/custom policies, franchise claims, pool freeze and retention validation before bidding UI.

**Prerequisites and dependencies:** Phase(s) 8; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/game-engines/src/auction/{rulesets, roster, retention, types}.ts; apps/server/src/modules/{auctions, teams}/*; apps/web/features/auction/setup/*

**Database changes:** auction_games, franchises, members, join requests, invites, pool, retention packages, acquisitions; UQ room/player.

**API and realtime changes:** claimFranchise, team request/approval basic flow, retention propose/lock; public purse projection.

**Frontend work:** S14–S19, S22 base squad view; historical vs simulator labels.

**Security checks:** Captain assignment server-owned; no two teams/member; same-room FKs; editable retained cost model identified.

**Tests and verification:** Concurrent claims; retention capped/uncapped/RTM cap; reserve protection; foreign identity; fresh disables RTM; pool feasibility.

**Definition of done:** Room can reach auction lobby with locked validated rosters and deterministic purse totals; collaborators can join but bidding capabilities finalized phase 11.

**Common implementation mistakes:** Treating salary cap as purse; applying2025 rules to every year; charging each capped allocation incorrectly.

### Copy-ready phase task

```text
Implement STUMPS phase 09: Auction rules,franchise foundation and retentions.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 8.

Objective and features:
Implement published historical/custom policies,franchise claims,pool freeze and retention validation before bidding UI.

Inspect existing modules, then create/update these paths only as needed:
packages/game-engines/src/auction/{rulesets,roster,retention,types}.ts; apps/server/src/modules/{auctions,teams}/*; apps/web/features/auction/setup/*

Database work (use migrations, policies, constraints and retention rules):
auction_games,franchises,members,join requests,invites,pool,retention packages,acquisitions; UQ room/player.

Transport contract and backend work:
claimFranchise,team request/approval basic flow,retention propose/lock; public purse projection.

UI work after the relevant contract is established:
S14–S19,S22 base squad view; historical vs simulator labels.

Security and fairness acceptance:
Captain assignment server-owned; no two teams/member; same-room FKs; editable retained cost model identified.

Required tests and failure scenarios:
Concurrent claims;retention capped/uncapped/RTM cap;reserve protection;foreign identity;fresh disables RTM;pool feasibility.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Treating salary cap as purse;applying2025 rules to every year;charging each capped allocation incorrectly.

This phase is done only when:
Room can reach auction lobby with locked validated rosters and deterministic purse totals; collaborators can join but bidding capabilities finalized phase11.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 10 — Bidding, RTM and auction resolution

**Objective:** Implement serial accepted bids, durable deadlines, anti-sniping, RTM stages, purchases, unsold second pass and pause boundaries.

**Prerequisites and dependencies:** Phase(s) 9; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/game-engines/src/auction/{bids, rtm, nomination, invariants}.ts; apps/server/src/modules/auctions/{command, settlement}.ts; apps/web/features/auction/stage/*

**Database changes:** auction_nominations, bids, deadline generations; acquisition uniqueness; purse invariant validator.

**API and realtime changes:** auction.bid, rtm.intent/finalOffer/match, pause/resume/skip; nominated, bidAccepted, timerChanged, sold/unsold events.

**Frontend work:** S20–S22; stable BidControlPanel, live stage, RTM decisions, history.

**Security checks:** Validate time after lock; one open lot; same validator all actors; no self-raise; integer rupees; no stale auto-rebid.

**Tests and verification:** Hundreds of parallel equal-version bids; exact deadline; late extension; sale retry; all RTM branches; reserve/overseas/full roster rejection.

**Definition of done:** Auction completes a finite pool with exactly one owner/player, nonnegative purse and no double sale after restart.

**Common implementation mistakes:** setTimeout sells; amount from client accepted unchecked; deducting standing bids twice; omitting final RTM raise opportunity.

### Copy-ready phase task

```text
Implement STUMPS phase 10: Bidding,RTM and auction resolution.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 9.

Objective and features:
Implement serial accepted bids,durable deadlines,anti-sniping,RTM stages,purchases,unsold second pass and pause boundaries.

Inspect existing modules, then create/update these paths only as needed:
packages/game-engines/src/auction/{bids,rtm,nomination,invariants}.ts; apps/server/src/modules/auctions/{command,settlement}.ts; apps/web/features/auction/stage/*

Database work (use migrations, policies, constraints and retention rules):
auction_nominations,bids,deadline generations; acquisition uniqueness; purse invariant validator.

Transport contract and backend work:
auction.bid,rtm.intent/finalOffer/match,pause/resume/skip; nominated,bidAccepted,timerChanged,sold/unsold events.

UI work after the relevant contract is established:
S20–S22; stable BidControlPanel,live stage,RTM decisions,history.

Security and fairness acceptance:
Validate time after lock; one open lot; same validator all actors; no self-raise; integer rupees; no stale auto-rebid.

Required tests and failure scenarios:
Hundreds of parallel equal-version bids;exact deadline;late extension;sale retry;all RTM branches;reserve/overseas/full roster rejection.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:concurrency
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
setTimeout sells;amount from client accepted unchecked;deducting standing bids twice;omitting final RTM raise opportunity.

This phase is done only when:
Auction completes a finite pool with exactly one owner/player,nonnegative purse and no double sale after restart.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 11 — Full collaboration, captain transfer and strategy

**Objective:** Complete mandatory multi-user teams, capability delegation, team invite approval, shortlists and command fencing.

**Prerequisites and dependencies:** Phase(s) 10; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/teams/{permissions, invitations, handover, strategy}.ts; apps/web/features/team/*; packages/contracts/teams.ts

**Database changes:** team_handovers, shortlists, shortlist_votes, capability fields, control lease constraints.

**API and realtime changes:** team.permissions, captain.propose/accept, invite.rotate, shortlist.upsert/vote; private events.

**Frontend work:** S17, S23; captain capability editor; strategy/approval drawers.

**Security checks:** Only team members read strategy; codes never bypass approval; host no team privilege; takeover fences old tabs.

**Tests and verification:** Captain+collaborator simultaneous same bid; revocation between command and handler; cross-team reads; handover unique captain; late medal membership.

**Definition of done:** Two humans jointly run one franchise without extra competitive vote/medal positions; team information stays private.

**Common implementation mistakes:** Using role string as trust; team code as blanket grant; giving host all franchise controls.

### Copy-ready phase task

```text
Implement STUMPS phase 11: Full collaboration,captain transfer and strategy.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 10.

Objective and features:
Complete mandatory multi-user teams,capability delegation,team invite approval,shortlists and command fencing.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/teams/{permissions,invitations,handover,strategy}.ts; apps/web/features/team/*; packages/contracts/teams.ts

Database work (use migrations, policies, constraints and retention rules):
team_handovers,shortlists,shortlist_votes,capability fields,control lease constraints.

Transport contract and backend work:
team.permissions,captain.propose/accept,invite.rotate,shortlist.upsert/vote;private events.

UI work after the relevant contract is established:
S17,S23; captain capability editor; strategy/approval drawers.

Security and fairness acceptance:
Only team members read strategy;codes never bypass approval;host no team privilege;takeover fences old tabs.

Required tests and failure scenarios:
Captain+collaborator simultaneous same bid;revocation between command and handler;cross-team reads;handover unique captain;late medal membership.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security; pnpm test:concurrency
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Using role string as trust;team code as blanket grant;giving host all franchise controls.

This phase is done only when:
Two humans jointly run one franchise without extra competitive vote/medal positions;team information stays private.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 12 — Reconnect, failover and safe automation

**Objective:** Implement durable replay, recovery pauses, controller takeover and deterministic opt-in auto-bids.

**Prerequisites and dependencies:** Phase(s) 11; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/presence/recovery.ts; apps/server/src/modules/auctions/auto-bid.ts; apps/server/src/jobs/recovery.ts; apps/web/features/reconnect/*; apps/web/features/team/auto/*

**Database changes:** auto_strategies, counters, job generations, participation intervals/accumulators, heartbeat lease indexes.

**API and realtime changes:** team.auto.configure/takeover; autoDecision/controlChanged/server.recovering; ticket renewal and snapshot cursor handshake.

**Frontend work:** S26, S35; missed purchases recap, observe-only label, explicit resume-manual button.

**Security checks:** Bots use same bid validator; strategy private; epoch prevents split control; no invented consent; revocation before replay.

**Tests and verification:** Mobile suspension; disconnect all bidders; co-captain remains; reconnect bot race; server crash; gap replay; duplicate event; outage vote exception.

**Definition of done:** Refresh/disconnect/restart restores state and shows real purchases; bot never exceeds configured caps or reserve.

**Common implementation mistakes:** Assuming Socket.IO recovery always succeeds; replaying a private stream after role loss; auto mode simply spending budget on best player.

### Copy-ready phase task

```text
Implement STUMPS phase 12: Reconnect,failover and safe automation.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 11.

Objective and features:
Implement durable replay,recovery pauses,controller takeover and deterministic opt-in auto-bids.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/presence/recovery.ts; apps/server/src/modules/auctions/auto-bid.ts; apps/server/src/jobs/recovery.ts; apps/web/features/reconnect/*; apps/web/features/team/auto/*

Database work (use migrations, policies, constraints and retention rules):
auto_strategies,counters,job generations,participation intervals/accumulators,heartbeat lease indexes.

Transport contract and backend work:
team.auto.configure/takeover;autoDecision/controlChanged/server.recovering;ticket renewal and snapshot cursor handshake.

UI work after the relevant contract is established:
S26,S35; missed purchases recap,observe-only label,explicit resume-manual button.

Security and fairness acceptance:
Bots use same bid validator;strategy private;epoch prevents split control;no invented consent;revocation before replay.

Required tests and failure scenarios:
Mobile suspension;disconnect all bidders;co-captain remains;reconnect bot race;server crash;gap replay;duplicate event;outage vote exception.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Assuming Socket.IO recovery always succeeds;replaying a private stream after role loss;auto mode simply spending budget on best player.

This phase is done only when:
Refresh/disconnect/restart restores state and shows real purchases;bot never exceeds configured caps or reserve.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 13 — Friends, chat, profiles and moderation

**Objective:** Complete persistent social UX and strictly temporary room/team chat.

**Prerequisites and dependencies:** Phase(s) 12; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/{profiles, friends, chat}/*; apps/web/features/{profile, friends, chat, notifications}/*; tests/security/chat-acl.spec.ts

**Database changes:** friendships, blocks, notifications, chat channels/messages/mutes; temporary invitation retention.

**API and realtime changes:** Profile edit/search; friend request/accept/remove; chat.send/remove; authorized channel history.

**Frontend work:** S24–S25, S29–S31; card room optional chat.

**Security checks:** Plain text rendering;500codepoint limit; rate/mute policies; friend privacy; no email search; private messages never logged.

**Tests and verification:** Cross-team read/replay denial; XSS strings; duplicate sends; blocked invites; chat cleanup; avatar media validation.

**Definition of done:** Friends persist across rooms, private chats cannot be read by opponents, all social views respect privacy.

**Common implementation mistakes:** Using hidden UI as ACL; storing room chat in persistent notifications; storing user medal counts from profile form.

### Copy-ready phase task

```text
Implement STUMPS phase 13: Friends,chat,profiles and moderation.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 12.

Objective and features:
Complete persistent social UX and strictly temporary room/team chat.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/{profiles,friends,chat}/*; apps/web/features/{profile,friends,chat,notifications}/*; tests/security/chat-acl.spec.ts

Database work (use migrations, policies, constraints and retention rules):
friendships,blocks,notifications,chat channels/messages/mutes; temporary invitation retention.

Transport contract and backend work:
Profile edit/search;friend request/accept/remove;chat.send/remove;authorized channel history.

UI work after the relevant contract is established:
S24–S25,S29–S31;card room optional chat.

Security and fairness acceptance:
Plain text rendering;500codepoint limit;rate/mute policies;friend privacy;no email search;private messages never logged.

Required tests and failure scenarios:
Cross-team read/replay denial;XSS strings;duplicate sends;blocked invites;chat cleanup;avatar media validation.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Using hidden UI as ACL;storing room chat in persistent notifications;storing user medal counts from profile form.

This phase is done only when:
Friends persist across rooms,private chats cannot be read by opponents,all social views respect privacy.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 14 — Voting, evaluation, finalization and medals

**Objective:** Implement15-second frozen-electorate voting, exact squad evaluator, qualification and idempotent medal commits.

**Prerequisites and dependencies:** Phase(s) 13; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/game-engines/src/{voting, evaluation, achievements}/*; apps/server/src/modules/{voting, achievements}/*; apps/server/src/jobs/evaluation.ts; apps/web/features/results/*

**Database changes:** end_votes, electorate, evaluation checkpoints, room_results, receipt unique keys+summaries; source state hashes.

**API and realtime changes:** vote.start/cast; vote.started/resolved; game.finalizing/completed; evaluation progress; results read.

**Frontend work:** S13, S27, S28; podium, score explanation, practice/ineligible labels.

**Security checks:** One franchise one vote; immutable ballot; atomic receipts and summary; no client winner; no provisional medals.

**Tests and verification:** N=1/2/4 thresholds; no/tied votes; exact expiry; mid-tie restoration; auction vote no sale; crash after receipts; XI optimizer oracle small fixtures.

**Definition of done:** Both games finish with accurate results and ≤3 competitive podium ranks; eligible collaborators credited once.

**Common implementation mistakes:** Yes divided by votes cast; restarting the15 seconds on refresh; heuristic XI called optimal; full match copied into achievements.

### Copy-ready phase task

```text
Implement STUMPS phase 14: Voting,evaluation,finalization and medals.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 13.

Objective and features:
Implement15-second frozen-electorate voting,exact squad evaluator,qualification and idempotent medal commits.

Inspect existing modules, then create/update these paths only as needed:
packages/game-engines/src/{voting,evaluation,achievements}/*; apps/server/src/modules/{voting,achievements}/*; apps/server/src/jobs/evaluation.ts; apps/web/features/results/*

Database work (use migrations, policies, constraints and retention rules):
end_votes,electorate,evaluation checkpoints,room_results,receipt unique keys+summaries;source state hashes.

Transport contract and backend work:
vote.start/cast;vote.started/resolved;game.finalizing/completed;evaluation progress;results read.

UI work after the relevant contract is established:
S13,S27,S28; podium,score explanation,practice/ineligible labels.

Security and fairness acceptance:
One franchise one vote;immutable ballot;atomic receipts and summary;no client winner;no provisional medals.

Required tests and failure scenarios:
N=1/2/4 thresholds;no/tied votes;exact expiry;mid-tie restoration;auction vote no sale;crash after receipts;XI optimizer oracle small fixtures.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:concurrency
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Yes divided by votes cast;restarting the15seconds on refresh;heuristic XI called optimal;full match copied into achievements.

This phase is done only when:
Both games finish with accurate results and ≤3 competitive podium ranks;eligible collaborators credited once.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 15 — Recoverable automatic cleanup

**Objective:** Implementresults TTL, freeze uploads, Storage deletion then root cascade, and abandoned-room recovery.

**Prerequisites and dependencies:** Phase(s) 14; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** apps/server/src/modules/cleanup/*; apps/server/src/jobs/cleanup.ts; scripts/audit-room-deletion.ts; tests/integration/cleanup.spec.ts

**Database changes:** room_assets, cleanup_tasks; complete cascade graph; expiry indexes and stranded-state scans.

**API and realtime changes:** room.expiring/closed; admin retry; after-expiry410; no private result persistent export by default.

**Frontend work:** Results expiry footer, expired detail state, operations cleanup queue.

**Security checks:** No gameplay writes during finalization/purge; no long-lived presigned writes; no deletion of shared assets; bounded/redacted logs.

**Tests and verification:** Delete failure+retry; two cleaners; crash between Storage/DB; in-flight upload; every T table empty; profiles, friends, medals preserved; restore sweep.

**Definition of done:** First complete end-to-end milestone: both games, medals and proven temporary data deletion; no stranded artifacts.

**Common implementation mistakes:** DELETE storage metadata without objects; cascading cleanup manifest too early; claiming immediate backup erasure.

### Copy-ready phase task

```text
Implement STUMPS phase 15: Recoverable automatic cleanup.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 14.

Objective and features:
Implementresults TTL,freeze uploads,Storage deletion then root cascade,and abandoned-room recovery.

Inspect existing modules, then create/update these paths only as needed:
apps/server/src/modules/cleanup/*; apps/server/src/jobs/cleanup.ts; scripts/audit-room-deletion.ts; tests/integration/cleanup.spec.ts

Database work (use migrations, policies, constraints and retention rules):
room_assets,cleanup_tasks;complete cascade graph;expiry indexes and stranded-state scans.

Transport contract and backend work:
room.expiring/closed;admin retry;after-expiry410;no private result persistent export by default.

UI work after the relevant contract is established:
Results expiry footer,expired detail state,operations cleanup queue.

Security and fairness acceptance:
No gameplay writes during finalization/purge;no long-lived presigned writes;no deletion of shared assets;bounded/redacted logs.

Required tests and failure scenarios:
Delete failure+retry;two cleaners;crash between Storage/DB;in-flight upload;every T table empty;profiles,friends,medals preserved;restore sweep.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
DELETE storage metadata without objects;cascading cleanup manifest too early;claiming immediate backup erasure.

This phase is done only when:
First complete end-to-end milestone: both games,medals and proven temporary data deletion;no stranded artifacts.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 16 — Premium polish, accessibility and performance UX

**Objective:** Complete all 35 screens, original art treatments, mobile controls, reduced motion and result audio preferences.

**Prerequisites and dependencies:** Phase(s) 15; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** packages/ui/*; apps/web/features/*; apps/web/public/original-assets/*; tests/visual/*; docs/design-review.md

**Database changes:** Only noncritical user UI preferences; no engine/schema shortcuts.

**API and realtime changes:** No new gameplay authority; continue using existing DTOs/events.

**Frontend work:** All S01–S35; six rarities, dual frame, tie pot, televised auction layout, podium, admin surfaces.

**Security checks:** Image source/rights review; private cache headers; no animation leaks hidden cards.

**Tests and verification:** Target viewports, screen readers,200%zoom, safe-area, slow network, image errors, large numbers, long names; animation interrupt/duplicate events.

**Definition of done:** Visual review passes without losing correctness, reduced motion or stable bid controls.

**Common implementation mistakes:** Polish rewrites engines; confetti blocks input; hidden critical alerts; decorative assets exceed budget.

### Copy-ready phase task

```text
Implement STUMPS phase 16: Premium polish,accessibility and performance UX.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 15.

Objective and features:
Complete all35 screens,original art treatments,mobile controls,reduced motion and result audio preferences.

Inspect existing modules, then create/update these paths only as needed:
packages/ui/*; apps/web/features/*; apps/web/public/original-assets/*; tests/visual/*; docs/design-review.md

Database work (use migrations, policies, constraints and retention rules):
Only noncritical user UI preferences;no engine/schema shortcuts.

Transport contract and backend work:
No new gameplay authority;continue using existing DTOs/events.

UI work after the relevant contract is established:
All S01–S35; sixrarities,dual frame,tie pot,televised auction layout,podium,admin surfaces.

Security and fairness acceptance:
Image source/rights review;private cache headers;no animation leaks hidden cards.

Required tests and failure scenarios:
Target viewports,screen readers,200%zoom,safe-area,slow network,image errors,large numbers,long names;animation interrupt/duplicate events.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Polish rewrites engines;confetti blocks input;hidden critical alerts;decorative assets exceed budget.

This phase is done only when:
Visual review passes without losing correctness,reduced motion or stable bid controls.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 17 — Full security, concurrency and load qualification

**Objective:** Execute risk-driven tests and close real failures across all modules; record measured capacity.

**Prerequisites and dependencies:** Phase(s) 16; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** tests/{unit, property, integration, concurrency, e2e, security, load}/*; scripts/run-fault-tests.ts; docs/release-evidence.md

**Database changes:** Validate indexes/query plans and invariant scans against realistic fixtures; no production destructive load.

**API and realtime changes:** Contract fuzzing, unknown event rejection, API/BFF/socket same behavior.

**Frontend work:** Playwright multi-context E2E including reconnect and accessibility-critical paths.

**Security checks:** Threat matrix test coverage, secret/dependency scan, CSRF/Origin, admin MFA, Data API denial.

**Tests and verification:** 10/30/100/300/1000socket profiles in staging; bid bursts; deadlocks; restarts; cleanup; DB outage; reconnect storms; record p50/p95/p99.

**Definition of done:** P0/P1 mandatory acceptance passes; measured capacity and unresolved risks stated; no unverified production-ready claims.

**Common implementation mistakes:** Testing only happy paths; using mocks for locking; assuming socket count alone represents load; load-testing real users.

### Copy-ready phase task

```text
Implement STUMPS phase 17: Full security,concurrency and load qualification.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 16.

Objective and features:
Execute risk-driven tests and close real failures across all modules;record measured capacity.

Inspect existing modules, then create/update these paths only as needed:
tests/{unit,property,integration,concurrency,e2e,security,load}/*; scripts/run-fault-tests.ts; docs/release-evidence.md

Database work (use migrations, policies, constraints and retention rules):
Validate indexes/query plans and invariant scans against realistic fixtures;no production destructive load.

Transport contract and backend work:
Contract fuzzing,unknown event rejection,API/BFF/socket same behavior.

UI work after the relevant contract is established:
Playwright multi-context E2E including reconnect and accessibility-critical paths.

Security and fairness acceptance:
Threat matrix test coverage,secret/dependency scan,CSRF/Origin,admin MFA,Data API denial.

Required tests and failure scenarios:
10/30/100/300/1000socket profiles in staging;bid bursts;deadlocks;restarts;cleanup;DB outage;reconnect storms;record p50/p95/p99.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:security; pnpm test:concurrency; pnpm test:e2e; pnpm test:load
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Testing only happy paths;using mocks for locking;assuming socket count alone represents load;load-testing real users.

This phase is done only when:
P0/P1 mandatory acceptance passes;measured capacity and unresolved risks stated;no unverified production-ready claims.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 18 — Deploy Vercel, Render and Supabase

**Objective:** Create reproducible deployment manifests, apply staged migrations, deploy compatible versions and verify private access.

**Prerequisites and dependencies:** Phase(s) 17; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** infrastructure/render.yaml; .github/workflows/deploy.yml; docs/runbooks/{deploy, rollback, restore, secrets}.md; apps/server/Dockerfile

**Database changes:** Separate staging/prod; CI-controlled migrations with backup/expand-contract; never auto-migrate every process.

**API and realtime changes:** Live/readinesshealth; TLS socket path; exact CORS/origins; Auth email redirects; version compatibility handshake.

**Frontend work:** Production domains, no-store dynamic pages, private image reads, status screen.

**Security checks:** Secret stores; operator MFA; least DB role; preview origins isolated fromprod; no production seed secrets.

**Tests and verification:** Real2-player card+2-team casual auction; MFA; password/rotation; restart mid-room; resultTTL purge; one email deliverability check.

**Definition of done:** Deployment evidence and rollback rehearsal exist; paid always-on configuration confirmed; no production launch if mandatory gates fail.

**Common implementation mistakes:** Render free instance treated as reliable; ephemeral disk authoritative; Vercel long-lived worker assumptions; wildcard credentialed CORS.

### Copy-ready phase task

```text
Implement STUMPS phase 18: Deploy Vercel,Render and Supabase.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 17.

Objective and features:
Create reproducible deployment manifests,apply staged migrations,deploy compatible versions and verify private access.

Inspect existing modules, then create/update these paths only as needed:
infrastructure/render.yaml; .github/workflows/deploy.yml; docs/runbooks/{deploy,rollback,restore,secrets}.md; apps/server/Dockerfile

Database work (use migrations, policies, constraints and retention rules):
Separate staging/prod;CI-controlled migrations with backup/expand-contract;never auto-migrate every process.

Transport contract and backend work:
Live/readinesshealth;TLS socket path;exact CORS/origins;Auth email redirects;version compatibility handshake.

UI work after the relevant contract is established:
Production domains,no-store dynamic pages,private image reads,status screen.

Security and fairness acceptance:
Secret stores;operator MFA;least DB role;preview origins isolated fromprod;no production seed secrets.

Required tests and failure scenarios:
Real2-player card+2-team casual auction;MFA;password/rotation;restart mid-room;resultTTL purge;one email deliverability check.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:e2e
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Render free instance treated as reliable;ephemeral disk authoritative;Vercel long-lived worker assumptions;wildcard credentialed CORS.

This phase is done only when:
Deployment evidence and rollback rehearsal exist;paid always-on configuration confirmed;no production launch if mandatory gates fail.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Phase 19 — Production operations and measured scaling

**Objective:** Establish monitoring, incident/cleanup playbooks, cost alerts, backup drills and scale only when measured.

**Prerequisites and dependencies:** Phase(s) 18; inspect their completed evidence before changing behavior.

**Files/modules to create or update:** docs/runbooks/{incidents, cleanup, capacity, cost, privacy, backup}.md; apps/server/src/observability/*; infrastructure/scaling/*

**Database changes:** Tune indexes, pool sizes and maintenance; add Redis adapter only with multi-instance load evidence and newADR.

**API and realtime changes:** Health, metrics, drain behavior andcompatible schema/event rollout; no extra public admin data.

**Frontend work:** Clear service status, admin errors queue, source freshness and asset expiry notices.

**Security checks:** Log minimization; privilege review; revocation latency checks; restore deletion sweeps; secret rotation drills.

**Tests and verification:** Staging restore, load at 2× expected launch demand, fanout replay with 2 instances if enabled, Redis outage fallback, DBpool ceiling.

**Definition of done:** Named operators, alert thresholds, monthlycost baseline andcapacity boundary documented; ongoing evidence can update plan.

**Common implementation mistakes:** Microservices before bottlenecks; claiming permanent scalability from one benchmark; leaving cleanup alerts unowned.

### Copy-ready phase task

```text
Implement STUMPS phase 19: Production operations and measured scaling.
Apply the Shared execution contract above in full. Read the master plan and relevant
companion sections before changing code. Required previous phase(s): 18.

Objective and features:
Establish monitoring,incident/cleanup playbooks,cost alerts,backup drills and scale only when measured.

Inspect existing modules, then create/update these paths only as needed:
docs/runbooks/{incidents,cleanup,capacity,cost,privacy,backup}.md; apps/server/src/observability/*; infrastructure/scaling/*

Database work (use migrations, policies, constraints and retention rules):
Tune indexes,pool sizes and maintenance;add Redis adapter only withmulti-instance load evidence and newADR.

Transport contract and backend work:
Health,metrics,drain behavior andcompatible schema/event rollout;no extra public admin data.

UI work after the relevant contract is established:
Clear service status,admin errors queue,source freshness and asset expiry notices.

Security and fairness acceptance:
Log minimization;privilege review;revocationlatency checks;restore deletion sweeps;secret rotation drills.

Required tests and failure scenarios:
Staging restore,load at2× expected launch demand,fanout replay with2instances if enabled,Redis outage fallback,DBpool ceiling.

Run applicable repository checks individually and inspect every result:
pnpm lint; pnpm typecheck; pnpm contracts:check; pnpm test:unit; pnpm build; pnpm db:reset; pnpm db:lint; pnpm test:integration; pnpm test:load
Use local/staging databases for destructive resets and fault/load tests. If a script
is absent, add its documented implementation or report the blocker; never mark a
missing script as passed. For phase0 do review work only, not application code.

Do not break completed earlier phases or alter game defaults silently. Specifically
avoid these common mistakes:
Microservices before bottlenecks;claiming permanent scalability from one benchmark;leaving cleanup alerts unowned.

This phase is done only when:
Named operators,alert thresholds,monthlycost baseline andcapacity boundary documented;ongoing evidence can update plan.

Report changed paths, migration IDs, executed checks and their actual results,
security/failure cases verified, known gaps and the next phase. Update traceability.
```

## Release blockers and change control

A phase may finish with an external dependency marked blocked only when it leaves safe behavior (for example, original demo assets rather than unlicensed photos). Do not call the full intended product complete while any mandatory workflow is still feature-flagged or absent. A source verification gap cannot be solved by inventing official rules; keep a clearly labeled simulator alternative and document the restriction. A production-readiness claim requires measured tests, operations evidence and rights/data approval—not a self-awarded10/10.

All phase prompts intentionally reference the same v1.0 contract. On an accepted requirements change, bump specification version, record reason, update shared schemas/test vectors/migrations/affected prompts and add a compatibility plan for active rooms. Room rules and data remain frozen for their lifetime. Bug fixes that change results require a new engine version and a stated policy for ongoing rooms, preferably finishing them with their original version or aborting with no competitive awards for integrity failures.
