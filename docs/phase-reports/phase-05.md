# Phase 05 report — Rooms, realtime and durable infrastructure

**Date:** 2026-10-10 · **Result:** complete. Starting a match returns an explicit `ENGINE_UNAVAILABLE` until the card engine (phase 07) and the auction engine (phase 10) register starters.

## Migration
- `040_rooms_streams_deadlines`: rooms, room_members, room_invites, room_connections, room_commands, room_streams, room_events, deadline_jobs, host_handovers, plus `request_receipts.resource_id → rooms` (CASCADE).
  - Same-room references use composite `(room_id, id)` foreign keys.
  - Every table has FORCE RLS, a `backend_runtime` policy, and app_runtime grants only.
  - `runtime_leases` already existed (010). `REQUIRED_MIGRATION` is now `040`.

## Changed paths
- **Server rooms** (`apps/server/src/rooms/*`):
  - `codes.ts`: 12 symbols × 5 bits from a CSPRNG, an HMAC lookup digest, and an encrypted code for authorized display.
  - `room-tx.ts`: the single write path. Order: room lock → idempotency receipt → DB clock → due deadlines → handler → events + receipt → commit → outbox wake.
  - `streams.ts`: per-audience sequences.
  - `projection.ts`: lobby/snapshot projections and replay (≤500 events / 256 KiB, otherwise `snapshotRequired`).
  - `starters.ts`, `deadline-handlers.ts`: lobby expiry 30 min / 2 h, host absence 60 s, handover expiry.
- **Server modules**:
  - `modules/rooms/{service,runtime}.ts`: create, join, ready, settings, start gates, leave, kick, host propose/accept, control takeover, and the late-bound runtime container.
  - `modules/commands/dispatcher.ts`: allowlist dispatcher with control-epoch fencing.
- **Server realtime**:
  - `realtime/dispatcher.ts`: transactional outbox → Socket.IO.
  - `realtime/rooms-socket.ts`: subscribe/presence/command/control, eviction on kick or close, and a stale-connection sweep.
- **Server jobs**: `jobs/deadlines.ts` (registry, SKIP LOCKED pass, fenced `CoordinatorLease`) and `jobs/room-workers.ts`.
- **Server wiring**: `routes/v1/rooms.ts`; `main.ts` wiring; `db/pool.ts` (idle-client errors no longer crash the process).
- **Contracts**: `packages/contracts/src/rooms.ts`, and `schema/http-operations.json` (+`GET /v1/me/rooms`).
- **Web, BFF and client plumbing**:
  - The BFF forwards a validated `Idempotency-Key`.
  - `lib/api-client.ts` sends one key per logical mutation and reuses it across the CSRF retry.
  - The `rooms` feature flag is on; the `teams` flag (phase 11) is off.
- **Web room feature** (`apps/web/features/room/*`):
  - `events.ts`: pure reducer with seq dedupe and gap detection.
  - `connection.ts`: Socket.IO with a fresh one-use ticket per attempt, HTTP snapshot/replay, and commands with HTTP fallback.
  - `useRoom.ts` and the components: `RoomCreationForm`, `AuctionCreationForm`, `RoomJoinForm`, `MultiplayerLobby`, `SettingsDialog`, `NumberField`.
- **Web pages**: S05 `/play/cards/create`, S06 `/play/cards/join`, S14 `/play/auction/create`, S15 `/play/auction/join`, S07 `/rooms/[id]/lobby`, S16 shell `/rooms/[id]/franchises`, S17 shell `/rooms/[id]/team/requests`.
- **Tests**:
  - `tests/integration/rooms.spec.ts` (17)
  - `tests/integration/rooms-realtime.spec.ts` (6, real Socket.IO)
  - `tests/security/rooms.spec.ts` (5)
  - `tests/concurrency/rooms.spec.ts` (7)
  - `tests/e2e/rooms.spec.ts` (two browser contexts)
  - `apps/web/test/room-events.spec.ts` (8)
  - `tests/support/realtime.ts`
- **CI**: the database job now runs `pnpm test:concurrency`.

## Checks actually run (all on local PostgreSQL 16)
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass (30 commands, 53 events, 67 error codes, 72 HTTP operations) |
| `pnpm test:unit` | pass (64) |
| `pnpm build` | pass |
| `pnpm db:reset` / `pnpm db:lint` | pass (6 migrations; 45 app_private tables) |
| `pnpm test:integration` | pass (62) |
| `pnpm test:security` | pass (43) |
| `pnpm test:concurrency` | pass (7) |
| `pnpm test:e2e` | pass (33; 3 desktop-only flows skipped on mobile) |

## Security and failure cases verified
- **Codes and passwords:**
  - Codes come from 60 random bits. Only the HMAC digest and ciphertext are stored.
  - Plaintext code and password are absent from the room, receipt, command and event rows.
  - Wrong password and unknown code return the same `JOIN_FAILED` and insert zero membership rows.
  - Unknown codes still spend one Argon2 verification.
  - Join guessing is rate-limited (429 after 10 per minute per user).
- **Capacity:**
  - Two joiners racing for the last seat: exactly one wins.
  - A burst of 7 joiners fills exactly 3 seats with unique seat numbers (room lock plus a per-user advisory lock taken first).
  - Limit of two active memberships per user.
- **Idempotency:**
  - 6 concurrent duplicates of one command produce one receipt, one event, and the same reply.
  - Same key with a different body returns `IDEMPOTENCY_CONFLICT`.
  - `POST /rooms` replays to the same room and code.
- **Readiness and settings:**
  - A settings change bumps `configVersion` and clears all ready flags.
  - Ready or start on an old version returns `STALE_CONFIG`.
- **Start gates:** too few players, not ready, uneven deal (with suggested legal totals), then `ENGINE_UNAVAILABLE` (the lobby stays open).
- **Concealment:**
  - Non-members, malformed IDs and other members' private streams all return 404.
  - A raw Socket.IO room name grants nothing.
  - Kick evicts the member's sockets immediately.
- **Host lifecycle:**
  - Host dropout: offline presence, then the durable `room.host_absent` job hands hosting to the earliest connected player.
  - Two racing workers transfer hosting exactly once.
  - A host who reconnects within the window keeps the room.
  - Voluntary transfer needs acceptance through the allowlisted `room.host.accept` command.
- **Duplicate tabs:**
  - Tabs are read-only until an explicit fenced takeover.
  - The old tab's commands then return `CONTROL_EPOCH_STALE`.
  - Client-sent internal actions return `UNKNOWN_COMMAND`.
- **Replay:** ordered per-stream replay; a gap beyond the window returns `snapshotRequired`; shuffled or duplicated deliveries converge on the in-order projection.
- **Lease:** a stale coordinator is fenced by a higher generation after expiry and cannot resume.
- **Restart:**
  - A brand-new runtime over the same DB serves the snapshot and settles persisted deadline jobs.
  - In the E2E test, a reload restores the lobby.

## Decisions and deviations
- `POST /rooms/:id/control` takes `deviceId` (the tab's live socket ID) and `currentEpoch`, matching DB §8.1. One socket follows one room, because `room_connections.socket_id` is unique.
- The HTTP snapshot reports `isController` as "no tab currently holds control". The socket snapshot reports it per tab.
- `GET /v1/me/rooms` was added to the HTTP catalog so the dashboard can return members to their rooms.
- Room endpoints require a finished profile, so lobbies never show placeholder names.
- Auction joins land on the S16 franchise shell, which shows the live roster with a notice. Franchise claiming is phase 09; nothing is simulated.

## Known gaps
- Phases 07 and 10 deliver the match engines (`GameStarter`) and game projections.
- Room invites to friends (`room_invites`, `POST /rooms/:id/invites`) are phase 13.
- Phase 14 adds the end-vote deferral of host transfer.
- Only per-instance stream-authorization caching exists. Re-checks happen on subscribe and every command, and eviction happens on kick or close. Phase 12 adds periodic 15-second re-checks.
- The GitHub push from this environment is still refused (HTTP 403). Commits are kept locally until access is fixed.

## Next phase
Phase 06 — Cricket data, original cards (with player portraits per ADR-017) and admin publishing.
