# Phase 15 report — Recoverable automatic cleanup

**Date:** 2026-10-17 · **Result:** complete, with the gaps listed at the end.

What now happens after a game:
- **Results expire and the room is deleted.** A finished room keeps its results for the results period. Then a cleaner freezes it, deletes every room object from Storage, checks that the room's Storage prefix is empty, and only then deletes the room row. The cascade removes every temporary record. Profiles, friendships, medals (receipts and summaries) and the published catalog stay.
- **Deletion survives failure.** Every room has one recoverable cleanup task. A Storage outage, a crash between Storage and the database, or two cleaners running at once never lose work, never repeat it, and never leave orphan objects. The room just stays closed (PURGING) until the objects are verifiably gone.
- **Abandoned games end.** A running room with nobody connected, seen or active for 30 minutes is aborted (no medals) and purged with no results period.
- **This is the first complete milestone:** both games run end to end, award medals, and then remove every temporary record and object.

Decisions are recorded in ADR-030.

## Migration
- **`120_cleanup`:**
  - `room_assets`: the deletion manifest for room-scoped Storage objects. Keys must sit under `rooms/<room_id>/` (CHECK), statuses run uploading → ready → deleting → deleted, and each upload has a lease.
  - `cleanup_tasks`: one per room, with stage, reason, next attempt time, attempts, a bounded error code and a lease.
  - An index on `rooms (lifecycle, result_expires_at)` for expiry scans.
  - The nine card references to `room_members` and `card_comparisons` (previously RESTRICT) are re-created as `DEFERRABLE INITIALLY DEFERRED`, so the root cascade can delete a started card room. Before this, a started card room could not be deleted at all.
  - FORCE RLS, backend policy and grants on both new tables.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `120_cleanup`. In the manifest, the planned "070" cleanup row now notes it shipped as 100, 110 and 120.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Server:**
  - `modules/cleanup/index.ts`:
    - creating tasks: `enqueueCleanup`, `deleteOrEnqueue`, `abortRoom`;
    - running them: `runCleanupPass`, which leases a task, then does freeze → assets → rows, with backoff;
    - recovery: `scanRooms`, the stranded and abandoned scan, which is also the restore sweep.
  - `modules/cleanup/assets.ts`: `uploadRoomAsset`. It registers the manifest row before writing, holds a 60 s lease, and refuses uploads once the room has closed.
  - `modules/cleanup/admin.ts`: the queue, retry and integrity abort.
  - `modules/cleanup/audit.ts`: `auditRoomDeletion`, the deletion proof.
  - `modules/media/storage.ts`: `list(prefix)` for local disk and Supabase Storage.
  - Finalization (`completeRoom`) creates the results task and emits `room.expiring`. The lobby expiry and leaving an empty lobby go through `deleteOrEnqueue`.
  - `runRoomCommand` refuses commands on closed rooms with `ROOM_GONE`. The snapshot returns 410 `ROOM_GONE`. Results return 410 `RESULTS_EXPIRED`. Expired and closed rooms no longer count towards the membership limit or `GET /me/rooms`.
  - Routes:
    - `POST /v1/rooms/:id/assets`;
    - `GET /v1/admin/cleanup` (AAL2);
    - `POST /v1/admin/cleanup/:roomId/retry` (AAL2);
    - `POST /v1/admin/rooms/:id/abort` (AAL2 + step-up).
  - `jobs/room-workers.ts`: at startup and then every 30 s, runs the scan followed by a cleanup pass. `main.ts` wires the media storage in, and `room.closed` goes out through `evictFromRoom`.
- **Contracts:**
  - `packages/contracts/src/cleanup.ts`: the upload payload and ack, the room lifecycle notice payloads (`room.expiring`, `room.closed`), `CleanupQueueDTO` and the admin abort body.
  - The HTTP and DTO catalogs are updated.
- **Web:**
  - The BFF allows 3 MiB request bodies on room asset uploads.
  - The S33 cleanup queue (`components/admin/CleanupQueue.tsx`) at `/admin/cleanup`, with retry, plus a nav link.
  - The results page already shows "Detailed match results expired" for a purged room.
- **Ops:** `scripts/audit-room-deletion` (`pnpm ops:audit-room-deletion <roomId…> | --sweep`).
- **Tests:**
  - `tests/integration/cleanup.spec.ts` (10).
  - `tests/e2e/voting.spec.ts` now expires the finished room, waits for the worker to delete it, and checks the expired results page.

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 67 error codes, 89 HTTP operations |
| `pnpm test:unit` | ✅ 234 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 19 migrations / 74 tables |
| `pnpm test:integration` | ✅ 147. The first run failed 1 test: a card test expected `game.completed` as the last event, but `room.expiring` now follows it. The test was updated and the re-run passed. |
| `pnpm test:security` | ✅ 46 |
| `pnpm test:concurrency` | ✅ 15 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 41 passed, 9 skipped (two-context flows run once, on desktop) |

## Verified behaviour
- **Card purge:** a started, finished card match with a room image purges after its results expire:
  - every `app_private` table with a `room_id` column is empty for the room, as are the root row and request receipts (the audit reads the table list from the live schema);
  - the Storage prefix is empty;
  - friendships, achievement receipts, summaries and profiles are unchanged.
- **Auction purge:** a finished auction purges the same way.
- **Storage failure (E31):**
  - a failing Storage delete leaves the room PURGING and the task records `STORAGE_REMOVE_FAILED`, the attempt count and a 1-minute backoff;
  - the root stays until the objects are gone;
  - a later pass finishes.
- **Two cleaners at once (E35):** one purges and the other skips. No error, no double work.
- **Crash between Storage and the database:** the objects are already gone when the retry runs, which counts as success, and the retry deletes the rows.
- **In-flight upload (E66):** the cleaner waits for the upload lease. An object written late is found by the re-list, and the task goes back to the assets stage before the root is deleted.
- **Abandoned room:** a running room idle for more than 30 minutes is aborted with no medals and purged.
- **Restore sweep (E70):** an expired RESULTS room with no task gets one and is purged. An orphan `rooms/<uuid>/` prefix whose room no longer exists is removed.
- **Lobby with an image:** leaving an empty lobby queues a task instead of deleting the row directly, and the objects are removed first.
- **Admin:**
  - the queue lists the stage, reason, attempts, error code and overdue flag, and no room content;
  - retry is refused for a running room;
  - a member cannot read the queue;
  - an integrity abort of a running room queues it (reason `aborted`), and retry then purges it;
  - both actions write audit rows without the room's identity.
  - The step-up requirement on abort is enforced by the route guard, but no test refuses an admin without a fresh step-up.
- **E2E:** after the vote ends the match, the room expires, the worker deletes it, and a reload shows "Detailed match results expired".

## Gaps and notes
- **Room images:** there is no read-URL route (`POST /rooms/:id/assets/:assetId/read-url`) and no screen uploads room images yet. The upload route exists so that deletion of room objects is real and tested.
- **Alerts:** there is no metrics or alert sink for overdue cleanup (phase 19). Today the S33 queue marks overdue rows.
- **`room.closed` across instances:** it reaches sockets on the same instance only. A socket on another instance finds out on its next request, which returns 410.
- **Backups:** deletion removes live rows and Storage objects. Managed database backups, WAL, provider logs and CDN caches keep their own retention, and the product does not claim immediate erasure from them. A restored backup must be swept (`--sweep`) before users are admitted. The restore drill runbook comes in phase 19.
