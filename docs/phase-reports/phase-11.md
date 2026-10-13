# Phase 11 report — Team collaboration, captain handover and the shortlist

**Date:** 2026-10-13 · **Result:** complete.

Two or more people can now run one franchise together:
- the captain gives each teammate explicit rights (bid, right to match, shortlist, ceilings, retentions, invite) and may name one co-captain;
- the captaincy moves only when the named teammate accepts within a minute;
- team codes only make requests, rotating a code revokes requests that are still waiting, and only the captain's friends can be put on the auto-join list;
- the team keeps a private shortlist with notes, ceilings and advisory votes.

Late joiners can observe and advise but cannot win this game's medal. Decisions are recorded in ADR-026.

## Migration
- **`080_team_collaboration`:**
  - New tables: `team_handovers`, `team_shortlists` and `shortlist_votes`, all FORCE RLS with the backend policy.
  - One co-captain per team (partial unique index).
  - `franchise_members.capability_version`.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `080_team_collaboration`, and the manifest is updated.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Contracts:**
  - `packages/contracts/src/teams.ts`: payloads and acks for permissions, captain propose/accept, invite rotate, shortlist upsert/remove/vote; the team event payloads; `TeamViewDTO` and `ShortlistViewDTO`.
  - New command `team.shortlist.remove`.
  - `NominationDTO.myTarget`.
  - Catalogs updated; `contracts:check` verifies all of them.
- **Server:**
  - New `apps/server/src/modules/teams/`:
    - `shared.ts`
    - `invitations.ts`: join request and decision, moved from the auctions module; rotation and friend auto-join.
    - `permissions.ts`, `handover.ts`, `strategy.ts`, `view.ts`
  - New routes `GET /v1/rooms/:id/team` and `GET /v1/rooms/:id/franchises/:f/shortlist`.
  - The auction starter freezes `eligible_at_start`.
  - Live commands re-check the control epoch under the lock.
  - The live snapshot gains `myTarget`, and a `team.requestJoin` action for players without a team.
- **Web:**
  - `apps/web/features/team/`: `useTeam`, `CapabilityEditor`, `TeamApproval` (S17) and `TeamShortlist` (S23).
  - The `/rooms/[id]/team/requests` and `/rooms/[id]/shortlist` pages.
  - Team and Shortlist links in the lobby and on the stage.
  - The shortlist target on the stage spotlight.
  - A "Help a team" late-join form on the stage.
- **Tests:**
  - `tests/integration/teams.spec.ts` (8 tests)
  - `tests/security/teams.spec.ts`
  - `tests/concurrency/teams.spec.ts`
  - E2E: the auction flow now also visits S17 and S23.
  - The auction test helper can add teammates before the start.

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 86 HTTP operations |
| `pnpm test:unit` | ✅ 207 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 15 migrations / 65 tables |
| `pnpm test:integration` | ✅ 110 |
| `pnpm test:security` | ✅ 44 |
| `pnpm test:concurrency` | ✅ 12 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 38 passed, 6 skipped (two-context flows run once, on desktop) |

## Verified behaviour
- **Same bid from one team:** the captain and a collaborator with the bid right send the same bid at once. Exactly one is accepted, the other gets `STALE_BID`, `ALREADY_LEADING` or `VERSION_CONFLICT`, and the franchise is still one team.
- **Revocation:** a bid prepared before the captain revoked the right is refused with 403 when handled, and the collaborator's lot shows `NO_BID_RIGHT`.
- **Delegation limits:**
  - Only the captain delegates; a teammate gets 403 and the rival captain 404.
  - A second co-captain is refused (`COCAPTAIN_TAKEN`).
  - `captain` cannot be given as a role.
- **Handover:**
  - Only the named teammate can accept.
  - An expired offer is closed (`HANDOVER_CLOSED`), and a newer offer replaces the older one.
  - After accepting there is exactly one captain matching the pointer, the old captain is co-captain, the control epoch is bumped, and the old captain can no longer delegate.
- **Concurrency:** an accept racing a replacement offer, in 5 rounds, always left exactly one captain matching the pointer.
- **Codes:**
  - Rotation makes the old code fail with 404 and revokes pending requests.
  - A non-friend on the auto-join list is refused (`NOT_FRIENDS`). A friend on the list joins at once as an advisor; everyone else still needs approval.
- **Late joiner:** approved as an advisor whatever role was asked, with `eligible_at_start = false`. They cannot be promoted or offered the captaincy (`LATE_JOINER`), while start members are eligible.
- **Shortlist:**
  - An advisor can add a target but not a ceiling; the captain sets the ceiling.
  - Votes tally, and the viewer's own vote is shown.
  - The live lot shows the target to the own team only.
  - The rival gets 404 on the shortlist route, on a vote, and on replaying the team stream.
  - A shortlisted lot with no bid still goes unsold.
- **Security:** the host who is not on a team gets 403 on decide, permissions, propose, rotate and vote, and 404 on the team view, shortlist and team stream. A code alone grants nothing until the captain approves.
- **Tab fencing:** a command from a tab whose control epoch is outdated is refused (`CONTROL_EPOCH_STALE`) and records no bid.

## Gaps and notes
- **Fencing test:** the integration test simulates the other tab's takeover by bumping the member's epoch directly; the socket takeover itself is covered by the phase-05 realtime tests.
- **Captain changes and other teams:** the public projections pick up a captain change on their next refresh. No public event is emitted, because the catalog defines captain events for the team stream only.
- **Next phases:**
  - automated control, failover to the co-captain and `team.auto.*`: phase 12;
  - the friends UI that feeds auto-join: phase 13;
  - votes and medals using `eligible_at_start`: phase 14.
