# Requirements traceability

STUMPS v1.0. Every mandatory requirement maps to an implementing phase, module and acceptance test. **Status** is updated at the end of every phase; `Planned` means no code exists yet. A requirement is `Done` only when its listed test exists and passed in that phase's report.

## 1. Requirements

| ID | Requirement | Phase(s) | Module(s) | Acceptance test | Status |
|---|---|---|---|---|---|
| RQ-01 | Private website gate: exactly 3 failed attempts per protected bucket, lockout, rotation (preserve/revoke) | 3 | server/modules/access-gate; web (public)/access | `tests/security/access-gate.spec.ts` | Done (phase 03) |
| RQ-02 | Supabase Auth closed enrollment via gate-bound invitation; login/recovery; HttpOnly BFF session | 3 | server/modules/auth; web lib/server-auth, app/api/v1 | `tests/security/auth-session.spec.ts` | Done (phase 03) |
| RQ-03 | Admin role from DB assignment + MFA (AAL2) + step-up; operator bootstrap script | 3 | server/modules/admin; scripts/bootstrap-admin | `tests/security/admin-mfa.spec.ts` | Done (phase 03) |
| RQ-04 | Browser roles denied on all app tables; FORCE RLS; app_runtime least privilege | 2 | supabase/migrations | `tests/integration/rls.spec.ts` | Done (phase 02) |
| RQ-05 | Two-game dashboard (S04) with profile/medal summary from receipts only | 4 | web (member)/play; packages/ui | `tests/e2e/dashboard.spec.ts` | Done (phase 04) |
| RQ-06 | Generated 12-char room codes, optional room password, capacity under lock, lobby readiness/config version, host lifecycle | 5 | server/modules/rooms, presence | `tests/integration/rooms.spec.ts; tests/concurrency/rooms.spec.ts; tests/security/rooms.spec.ts; tests/e2e/rooms.spec.ts` | Done (phase 05) |
| RQ-07 | Command receipts/idempotency, audience streams, outbox, snapshot/replay, durable deadlines, runtime lease | 5 | server/db/transaction; realtime/*; jobs/* | `tests/integration/rooms-realtime.spec.ts; tests/integration/rooms.spec.ts; tests/concurrency/rooms.spec.ts` | Done (phase 05) |
| RQ-08 | Cricket data pipeline: sources, versions, immutable publish, synthetic ratings v1, stars, rarity, dual cards | 6 | game-engines/ratings; server/modules/cricket-data, admin/catalog | `packages/game-engines/test/{cricsheet,ratings}.spec.ts; tests/integration/catalog.spec.ts` | Done (phase 06) |
| RQ-09 | Six rarity card renderers + dual card; readable on 360px | 6,16 | web components/cards; packages/ui | `tests/e2e/cards.spec.ts` (six rarities + dual, 360 px and desktop screenshots, axe) | Done (phase 06); polish phase 16 |
| RQ-10 | Player portraits on every card and every auction lot (ADR-017, product-owner requirement) | 6,7,10,16 | media pipeline; PremiumCricketCard; AuctionPlayerSpotlight | `tests/integration/catalog.spec.ts; tests/e2e/cards.spec.ts` | Partial — cards (phase 06): strict publish gate (approved photo in IPL jersey + required facts, ADR-019), photo serving, every card renders its photo(s); card arena (phase 07) shows the photo on every revealed card (`tests/e2e/card-match.spec.ts`); auction lots in phases 09–10 under the same gate |
| RQ-11 | Committed randomness (seed commitment, HMAC streams, rejection sampling), stratified fair deal | 7 | game-engines/card/rng, deal; server/modules/cards/starter (ADR-021) | `packages/game-engines/test/card.spec.ts; tests/integration/cards.spec.ts` (commitment verified against the disclosed seed) | Done (phase 07) |
| RQ-12 | Normal contest: reveal all tops, selector chooses, timeout policy, pot to winner tail, selector passes | 7 | game-engines/card/reduce; server/modules/cards (commands, deadlines, projection) | `packages/game-engines/test/card.spec.ts; tests/integration/cards.spec.ts; tests/concurrency/cards.spec.ts; tests/e2e/card-match.spec.ts` | Done (phase 07) |
| RQ-13 | Card conservation N through all transitions (DECK/ACTIVE/POT single location) | 7,8 | game-engines/card/invariants; migration 050 location CHECK + deferred conservation trigger | `tests/property/card-conservation.spec.ts; tests/integration/cards.spec.ts` | Done (phases 07–08; property test covers ties, end requests, grace and restore) |
| RQ-14 | Ties, repeated ties, exhaustion, sole contributor, fallback, tie cap, elimination after award | 8 | game-engines/card/ties, ranking; server/modules/cards (fallback audit, migration 052) (ADR-023) | `packages/game-engines/test/card-ties.spec.ts; tests/fixtures/cards/tie-scenarios.json; tests/property/card-conservation.spec.ts; apps/web/test/card-arena.spec.ts` | Done (phase 08) |
| RQ-15 | Card podium, cycle guard, time/vote endings, restoration of unresolved chain | 8,14 | game-engines/card/ranking, termination; server/modules/cards/tie-service (soft limit + 60 s grace, 120 min hard ceiling) (ADR-023) | `packages/game-engines/test/card-ties.spec.ts; tests/property/card-conservation.spec.ts; tests/integration/cards.spec.ts` | Done (phase 08); vote trigger UI in phase 14 |
| RQ-16 | Auction rulesets (historical 2025 preset labeled simulation, CASUAL_v1), fresh/retention formats | 9 | game-engines/auction/rulesets | `packages/game-engines/test/auction-rulesets.spec.ts` | Planned |
| RQ-17 | Franchise claim, team approval, retention packages with cost model and caps | 9 | server/modules/auctions, teams | `tests/integration/auction-setup.spec.ts` | Planned |
| RQ-18 | Bidding: increments, reserve, overseas, squad caps, XI feasibility, late-bid extension, exact deadline | 10 | game-engines/auction/bids; server/modules/auctions/command | `tests/concurrency/bids.spec.ts` | Planned |
| RQ-19 | RTM intent/raise/match stages, entitlement accounting, unsold second pass, host pause/skip | 10 | game-engines/auction/rtm, nomination | `packages/game-engines/test/auction-rtm.spec.ts` | Planned |
| RQ-20 | Multi-user franchises: capabilities, captain handover, invite codes need approval, shortlists, control epoch | 11 | server/modules/teams | `tests/security/team-acl.spec.ts` | Planned |
| RQ-21 | Reconnect/replay, recovery pause after outage, controller takeover, deterministic opt-in auto-bid | 12 | presence/recovery; auctions/auto-bid | `tests/integration/recovery.spec.ts` | Planned |
| RQ-22 | Profiles, friends, blocks, notifications, public + private team chat (plain text, ACL on read/replay) | 13 | server/modules/profiles, friends, chat | `tests/security/chat-acl.spec.ts` | Planned |
| RQ-23 | 15-second end vote: frozen electorate, one ballot per franchise, strict majority, timer restore | 14 | game-engines/voting; server/modules/voting | `packages/game-engines/test/voting.spec.ts; tests/integration/voting.spec.ts` | Planned |
| RQ-24 | Exact XI squad evaluator, legality gate, ranking tiebreaks | 14 | game-engines/evaluation; jobs/evaluation | `packages/game-engines/test/evaluation.spec.ts` | Planned |
| RQ-25 | Qualification, top-three medals, team credits, idempotent receipts and summaries | 14 | game-engines/achievements; server/modules/achievements | `tests/integration/finalization.spec.ts` | Planned |
| RQ-26 | Results TTL then recoverable Storage→DB deletion; abandoned-room handling | 15 | server/modules/cleanup; jobs/cleanup | `tests/integration/cleanup.spec.ts` | Planned |
| RQ-27 | All 35 screens responsive/accessible, reduced motion, stable bid controls | 4–16 | web features/*; packages/ui | `tests/e2e/*.spec.ts (axe)` | Planned |
| RQ-28 | Admin catalog editor, operations dashboard, announcements, restrictions, audit | 6,16 | server/modules/admin; web (admin) | `tests/e2e/admin.spec.ts` | Planned |
| RQ-29 | Rate limits, CSRF/Origin, ticket one-use, redacted logs, no secrets in browser bundles | 3,17 | server/observability; realtime/tickets | `tests/security/*.spec.ts` | Planned |
| RQ-30 | Deployment manifests, runbooks, monitoring, measured capacity | 17–19 | infrastructure/*; docs/runbooks | `docs/release-evidence.md` | Planned |

## 2. Edge cases (master plan §8)

Test names include the ID (e.g. `it('E17 bid exactly at deadline is rejected')`).

| ID | Phase | Module | Test file | Status |
|---|---|---|---|---|
| E01 | 3 | access-gate | `tests/security/access-gate.spec.ts` | Done (phase 03) |
| E02 | 3 | access-gate | `tests/security/access-gate.spec.ts` | Done (phase 03) |
| E03 | 3 | auth/access-gate | `tests/security/auth-session.spec.ts` | Done (phase 03) |
| E04 | 5 | rooms | `tests/security/rooms.spec.ts` | Done (phase 05) |
| E05 | 5 | rooms | `tests/integration/rooms.spec.ts` | Done (phase 05) |
| E06 | 5 | rooms/presence | `tests/concurrency/rooms.spec.ts; tests/integration/rooms-realtime.spec.ts` | Done (phase 05) |
| E07 | 7 | cards | `tests/integration/card-timeout.spec.ts` | Planned |
| E08 | 8 | cards | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| E09 | 8 | cards | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| E10 | 8 | cards | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| E11 | 8 | cards | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| E12 | 7 | cards | `packages/game-engines/test/card-reduce.spec.ts` | Planned |
| E13 | 5 | rooms | `tests/concurrency/rooms.spec.ts` | Done (phase 05) |
| E14 | 12 | teams/presence | `tests/integration/recovery.spec.ts` | Planned |
| E15 | 11 | teams/auctions | `tests/concurrency/team-bids.spec.ts` | Planned |
| E16 | 10 | auctions | `tests/concurrency/bids.spec.ts` | Planned |
| E17 | 10 | auctions | `tests/integration/bid-deadline.spec.ts` | Planned |
| E18 | 10 | auctions | `packages/game-engines/test/auction-nomination.spec.ts` | Planned |
| E19 | 10 | auctions | `packages/game-engines/test/auction-bids.spec.ts` | Planned |
| E20 | 10 | auctions | `tests/concurrency/bids.spec.ts` | Planned |
| E21 | 10 | auctions | `packages/game-engines/test/auction-bids.spec.ts` | Planned |
| E22 | 9 | auctions | `packages/game-engines/test/auction-retention.spec.ts` | Planned |
| E23 | 12 | presence | `tests/integration/recovery.spec.ts` | Planned |
| E24 | 12 | auctions/auto-bid | `tests/integration/auto-bid.spec.ts` | Planned |
| E25 | 12 | presence | `tests/integration/control-lease.spec.ts` | Planned |
| E26 | 10 | auctions | `tests/integration/bid-fault.spec.ts` | Planned |
| E27 | 14 | voting | `tests/integration/voting.spec.ts` | Planned |
| E28 | 14 | voting/cards | `tests/integration/voting.spec.ts` | Planned |
| E29 | 14 | voting | `packages/game-engines/test/voting.spec.ts` | Planned |
| E30 | 14 | voting | `packages/game-engines/test/voting.spec.ts` | Planned |
| E31 | 15 | cleanup | `tests/integration/cleanup.spec.ts` | Planned |
| E32 | 14 | achievements | `tests/integration/finalization.spec.ts` | Planned |
| E33 | 13 | chat | `tests/security/chat-acl.spec.ts` | Planned |
| E34 | 15 | cleanup/results | `tests/integration/cleanup.spec.ts` | Planned |
| E35 | 15 | cleanup | `tests/concurrency/cleanup.spec.ts` | Planned |
| E36 | 12 | auth/realtime | `tests/security/revocation.spec.ts` | Planned |
| E37 | 5 | rooms | `tests/integration/rooms.spec.ts` | Done (phase 05) |
| E38 | 5 | rooms | `tests/integration/rooms.spec.ts; tests/e2e/rooms.spec.ts` | Done (phase 05) |
| E39 | 7 | cards/catalog | `tests/integration/card-setup.spec.ts` | Planned |
| E40 | 5 | rooms/cards | `tests/integration/rooms.spec.ts` (start refusal + suggested totals; card deal itself phase 07) | Done (phase 05) |
| E41 | 6 | cricket-data | `packages/game-engines/test/ratings.spec.ts` | Done (phase 06) |
| E42 | 7 | cards | `packages/game-engines/test/card-deal.spec.ts` | Planned |
| E43 | 5 | transaction | `tests/concurrency/rooms.spec.ts; tests/integration/rooms.spec.ts` | Done (phase 05) |
| E44 | 5 | transaction | `tests/concurrency/rooms.spec.ts; tests/integration/rooms.spec.ts` | Done (phase 05) |
| E45 | 5 | realtime | `apps/web/test/room-events.spec.ts` | Done (phase 05) |
| E46 | 5 | realtime | `tests/concurrency/rooms.spec.ts; tests/integration/rooms.spec.ts` | Done (phase 05) |
| E47 | 5 | transaction | `tests/integration/transaction.spec.ts` | Done (phase 05) |
| E48 | 12 | realtime/web | `tests/e2e/reconnect.spec.ts` | Planned |
| E49 | 17 | realtime | `tests/load/reconnect-storm.ts` | Planned |
| E50 | 12 | presence | `tests/integration/recovery.spec.ts` | Planned |
| E51 | 10 | auctions | `tests/integration/bid-deadline.spec.ts` | Planned |
| E52 | 14 | voting | `tests/integration/voting.spec.ts` | Planned |
| E53 | 14 | voting | `tests/integration/voting.spec.ts` | Planned |
| E54 | 14 | voting | `tests/integration/voting.spec.ts` | Planned |
| E55 | 14 | voting | `packages/game-engines/test/voting.spec.ts` | Planned |
| E56 | 14 | voting | `tests/integration/voting.spec.ts` | Planned |
| E57 | 10 | auctions | `packages/game-engines/test/auction-rtm.spec.ts` | Planned |
| E58 | 10 | auctions | `packages/game-engines/test/auction-rtm.spec.ts` | Planned |
| E59 | 12 | auto-bid | `packages/game-engines/test/auto-bid.spec.ts` | Planned |
| E60 | 12 | auto-bid | `tests/concurrency/takeover.spec.ts` | Planned |
| E61 | 14 | achievements | `tests/integration/finalization.spec.ts` | Planned |
| E62 | 14 | evaluation | `packages/game-engines/test/evaluation.spec.ts` | Planned |
| E63 | 14 | evaluation | `tests/integration/evaluation-resume.spec.ts` | Planned |
| E64 | 6 | cricket-data | `tests/integration/catalog.spec.ts` (published version immutable; new data → new version) | Done (phase 06) |
| E65 | 6 | media | `apps/server/test/unit/media.spec.ts; tests/integration/catalog.spec.ts` | Done (phase 06) |
| E66 | 15 | cleanup | `tests/integration/cleanup.spec.ts` | Planned |
| E67 | 13 | friends | `tests/integration/friends.spec.ts` | Planned |
| E68 | 13 | chat | `tests/security/chat-acl.spec.ts` | Planned |
| E69 | 16 | admin | `tests/security/admin-scope.spec.ts` | Planned |
| E70 | 19 | ops | `docs/runbooks/restore.md drill` | Planned |
| E71 | 3 | auth | `tests/security/auth-session.spec.ts` | Done (phase 03) |
| E72 | 14 | achievements | `tests/integration/finalization.spec.ts` | Planned |

## 3. Gameplay acceptance vectors (rules §14)

| ID | Given/When/Then | Phase | Test file | Status |
|---|---|---|---|---|
| V01 | Four revealed values 92,87,94,79 → C receives exactly 4; N conserved; C selector | 7 | `packages/game-engines/test/card-reduce.spec.ts` | Planned |
| V02 | 94,94,82,76 then 88,96 → B receives 6; C/D submit once only | 8 | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| V03 | Three tied, one exhausted → other two submit; exhausted seat cannot choose | 8 | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| V04 | All tied exhausted → fallback winner only from last tied set | 8 | `packages/game-engines/test/card-ties.spec.ts` | Planned |
| V05 | Unique winner had zero deck after reveal → survives; elimination after award | 7 | `packages/game-engines/test/card-reduce.spec.ts` | Planned |
| V06 | Three simultaneous zero-card losers → stored elimination tie-break, stable podium | 8 | `packages/game-engines/test/card-termination.spec.ts` | Planned |
| V07 | Same category command retried → one transition, one receipt, one pot movement | 7 | `tests/integration/card-commands.spec.ts` | Planned |
| V08 | Cycle state seen three times → time/cycle ranking; no endless repeat | 8 | `packages/game-engines/test/card-termination.spec.ts` | Planned |
| V09 | Vote passes mid-tie → every contribution restored once | 14 | `tests/integration/voting.spec.ts` | Planned |
| V10 | Two equal opposing bids, same version → exactly one accepted; no double charge | 10 | `tests/concurrency/bids.spec.ts` | Planned |
| V11 | Bid validated at exact expiry → rejected; timer wins | 10 | `tests/integration/bid-deadline.spec.ts` | Planned |
| V12 | Accepted bid leaves <8 s → deadline ≥ acceptance+8 s | 10 | `packages/game-engines/test/auction-bids.spec.ts` | Planned |
| V13 | RTM holder matches raised offer → one purchase, one deduction, entitlement decremented | 10 | `packages/game-engines/test/auction-rtm.spec.ts` | Planned |
| V14 | RTM holder times out → original bidder buys at binding final offer | 10 | `packages/game-engines/test/auction-rtm.spec.ts` | Planned |
| V15 | Team cannot preserve reserve → BUDGET_RESERVE with allowed ceiling | 10 | `packages/game-engines/test/auction-bids.spec.ts` | Planned |
| V16 | Bot command with old epoch after takeover → rejected without spend | 12 | `tests/concurrency/takeover.spec.ts` | Planned |
| V17 | Electorate 4: 2 Yes, 1 No, 1 abstain → continue; 3 Yes required | 14 | `packages/game-engines/test/voting.spec.ts` | Planned |
| V18 | Two users of same franchise vote → frozen representative only; one ballot | 14 | `tests/integration/voting.spec.ts` | Planned |
| V19 | No legal squad at auction end → no qualifying champion or medals | 14 | `packages/game-engines/test/evaluation.spec.ts` | Planned |
| V20 | Only two eligible squads → gold/silver only | 14 | `packages/game-engines/test/achievements.spec.ts` | Planned |
| V21 | Crash after medal commit, retry finalizer → no duplicate receipt or counters | 14 | `tests/integration/finalization.spec.ts` | Planned |

## 4. Cross-workflow acceptance (master §7.1)

| Scenario | Phase | Test |
|---|---|---|
| No gate grant → dashboard/API/media/socket denied | 3 | `tests/security/auth-session.spec.ts`, `tests/security/socket-tickets.spec.ts`, `tests/e2e/shell.spec.ts` (done, phase 03; media URLs in phase 06) |
| Third wrong code concurrently in two tabs | 3 | `tests/security/access-gate.spec.ts` (done, phase 03) |
| Admin rotates in revoke mode → bid requires reverification | 3, 10 | `tests/security/access-gate.spec.ts` |
| Host changes rules → readiness cleared | 5 | `tests/integration/rooms.spec.ts` |
| Collaborator knows team code → private chat denied before approval | 11, 13 | `tests/security/team-acl.spec.ts` |
| Captain + collaborator bid same version → never two deductions | 11 | `tests/concurrency/team-bids.spec.ts` |
| Vote during auction fails → no sale during pause, time restored | 14 | `tests/integration/voting.spec.ts` |
| Franchise wins with 3 eligible members, finalizer retried twice | 14 | `tests/integration/finalization.spec.ts` |
| Late advisor → no unearned medal | 14 | `tests/integration/finalization.spec.ts` |
| Storage deletion fails → root stays PURGING until objects absent | 15 | `tests/integration/cleanup.spec.ts` |
| Server dies after commit before ack → original receipt returned | 5 | `tests/integration/idempotency.spec.ts` |
| Incomplete high-score squad vs legal squad | 14 | `packages/game-engines/test/evaluation.spec.ts` |

## 5. Phase completion log

| Phase | Date | Result | Report |
|---|---|---|---|
| 00 | 2026-10-09 | Docs and contract catalogs created | `docs/phase-reports/phase-00.md` |
| 01 | 2026-10-09 | Runnable monorepo, health-only API, branded shell | `docs/phase-reports/phase-01.md` |
| 02 | 2026-10-09 | Migrations 000–030, RLS/grants, transaction helper, Auth adapter, admin bootstrap | `docs/phase-reports/phase-02.md` |
| 03 | 2026-10-09 | Gate, BFF, Auth adapter flows, admin MFA/step-up, socket tickets, S01–S03/S32 | `docs/phase-reports/phase-03.md` |
| 04 | 2026-10-09 | Design primitives, fonts, S04 dashboard, hubs, profile shell, connection boundary | `docs/phase-reports/phase-04.md` |
| 05 | 2026-10-10 | Rooms, members, command receipts, durable events, deadline jobs, leases, Socket.IO realtime | `docs/phase-reports/phase-05.md` |
| 06 | 2026-10-10 | Cricsheet pipeline, ratings v1 (0–100 Attax scale), media pipeline, card renderers, S08/S10/S34; follow-ups: strict data + IPL-jersey photo gate (ADR-019); legend cards and Platinum pairs (ADR-020) | `docs/phase-reports/phase-06.md` |
