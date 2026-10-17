# ADR-030: Recoverable automatic room cleanup

- **Status:** Accepted (phase 15, 17 October 2026).
- **Implements:** DB/realtime §5 (`room_assets`, `cleanup_tasks`, retention classes), §7 steps 4–5 (PURGING and the root cascade), §4 (cleanup workers, stranded-state scans) and §11 (room uploads); rules §1 (results period, lobby and running-room abandonment); screens S13, S27 and S33. It refines ADR-010.
- **Context:** before this phase nothing deleted a room once it had started:
  - RESULTS rooms stayed for ever and still counted towards the two-room membership limit;
  - ABORTED and PURGING were never set;
  - a running room that everyone had left stayed RUNNING;
  - started card rooms could not be deleted at all, because nine `ON DELETE RESTRICT` references from the card tables to `room_members` are checked part-way through the cascade.

  The spec's named mistakes: deleting Storage metadata without the objects, cascading the cleanup manifest too early, and claiming immediate backup erasure.

## Decision

### 1. One recoverable task per room
`cleanup_tasks` (room_id PK) records the stage (freeze → assets → rows), the reason, the next attempt time, attempts, the last error code and a lease. It is created in the same transaction that makes a room deletable:
- **Finalization** (`completeRoom`): due when the results expire, together with a public `room.expiring {expiresAt, reason, profileUrl}`.
- **An integrity abort or an abandoned running room:** due at once, with no results period and no medals.
- **An empty lobby that has Storage objects:** due at once. A lobby without objects is still deleted directly.

### 2. Stages
1. **freeze**, under the room lock:
   - The room becomes PURGING. A lobby, which never started, becomes ABORTED and gets a start stamp, as the schema requires; both states read as closed.
   - Connections, invites, host handovers and every deadline job are deleted.
   - Ready assets become `deleting`. Former members get `room.closed {expiresAt, reason, profileUrl}` and nothing that could rebuild the room.
   - If an upload is in flight, the task waits for its lease (at most 60 s) to end.
2. **assets**, outside any transaction:
   - Delete every manifest object plus everything listed under `rooms/<roomId>/`; objects that are already gone count as deleted.
   - List the prefix again; only when it is empty are the manifest rows marked `deleted`.
   - The manifest is never removed while objects might remain.
3. **rows**, under the room lock:
   - List the prefix once more. A late object sends the task back to `assets`.
   - Check that every manifest row is `deleted`, then `DELETE` the root row. The cascade removes every temporary row, including commands, events, chat, votes, card and auction state, results, the manifest, the task itself and request receipts pointing at the room.

### 3. Recovery and concurrency
- **Locking:** a cleaner takes due tasks with `SELECT … FOR UPDATE SKIP LOCKED` on the room plus a 2-minute lease on the task. A second cleaner skips both, so two cleaners never repeat work (E35).
- **Failures:** a Storage or database failure records `attempts`, a bounded error code (for example `STORAGE_REMOVE_FAILED`) and the next attempt time, after 1, 5, 15 and 60 minutes, then hourly. The root stays an inaccessible PURGING room until the objects are verifiably gone (E31).
- **Crash between Storage and the database:** the retry finds the objects already missing, which counts as success, and finishes the rows.
- **Freezing removes the paths that write to the room:**
  - `runRoomCommand` refuses every command on a PURGING or ABORTED room with `ROOM_GONE`;
  - the snapshot returns 410 `ROOM_GONE`;
  - results return 410 `RESULTS_EXPIRED`;
  - the room no longer counts towards any membership limit or `GET /me/rooms`. Neither does a RESULTS room past its expiry.

### 4. Room uploads
- `POST /v1/rooms/:id/assets` is the only room-scoped write to Storage:
  - the bytes go through the backend; there are no presigned write URLs;
  - the image is decoded and re-encoded (PNG/JPEG/WebP ≤ 2 MiB, no SVG);
  - each object is registered in `room_assets` with a 60-second upload lease before it is written, under the room's own prefix only (a CHECK enforces `rooms/<room_id>/`);
  - a room holds at most 20 images.
- Uploads are refused once the room has finished or started purging.
- An upload already in flight is waited out and its late object removed by the re-list (E66).
- Shared media (portraits, avatars, emblems) never lives under a room prefix and is never touched.

### 5. Abandonment and the stranded-state scan
`scanRooms` runs at startup (the first worker tick), every 30 seconds, and from the restore sweep:
- **Abandoned:** a RUNNING room with no live connection, no member seen and no activity for 30 minutes becomes ABORTED (no medals) and is purged without a results period.
- **No task:** expired RESULTS, ABORTED and PURGING rooms without a task get one.
- **Stuck:** an auction stuck in FINALIZING gets its evaluation job back. A card room in FINALIZING (impossible since phase 14) is aborted.
- **No timer:** a lobby without an expiry timer gets one back.
- **Orphan prefixes:** a `rooms/<uuid>/` prefix whose room no longer exists is deleted.
- **Never touched:** global or catalog assets, profiles, friendships, receipts and summaries.

### 6. Started card rooms delete by cascade
Migration 120 re-creates the nine card references to `room_members` and `card_comparisons` as `DEFERRABLE INITIALLY DEFERRED` (no action, checked at commit), as migration 100 did for the franchise captain. Deleting the root removes the whole graph in one statement. Deleting a referenced member directly still fails at commit.

### 7. Proof, operations and honest limits
- **Deletion audit:** `auditRoomDeletion` (also `pnpm ops:audit-room-deletion <roomId…>`) reads every `app_private` table with a `room_id` column from the live schema, plus the root and `request_receipts.resource_id`, and lists the Storage prefix. All must be empty. `--sweep` runs the scan and cleanup for an operator after a backup restore, before users are admitted (E70).
- **S33 operations queue** (`GET /v1/admin/cleanup`, AAL2): stage, reason, attempts, error code, next try and an overdue flag (15 minutes past due). It shows no room names, members, chat or results.
- **Admin retry** (`POST /v1/admin/cleanup/:roomId/retry`, AAL2): only for expired results, aborted or purging rooms.
- **Integrity abort** (`POST /v1/admin/rooms/:id/abort`, AAL2 + step-up): no medals. Both write an audit row without the room's identity or content.
- **Logs:** cleanup logs carry counts and error codes only.
- **What deletion does not cover:** it removes live rows and Storage objects. SQL `DELETE` is not physical erasure, and managed database backups, WAL, provider logs and CDN caches keep their own retention, as do anything users saved themselves. The product does not promise immediate erasure from backups. A restore must be swept before it is opened.

## Consequences
- Both games now finish, award medals and then delete every temporary record and object. This is the first complete end-to-end milestone.
- A Storage outage leaves rooms in the queue (visible in S33) instead of losing work or leaving orphan files.
- Not built:
  - read URLs for room images (`POST /rooms/:id/assets/:assetId/read-url`): no screen uses room images yet;
  - a metrics or alert sink for overdue cleanup (phase 19); the queue marks overdue rows today;
  - cross-instance socket fan-out of `room.closed` (sockets on other instances find out on their next request, which returns 410).
