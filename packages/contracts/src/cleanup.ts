import { z } from 'zod';
import { IsoTimestamp, Uuid } from './primitives';

/**
 * Recoverable room cleanup (DB/realtime §7, ADR-030): room-scoped uploads
 * registered in a deletion manifest, the former-member notices and the
 * operations cleanup queue. No payload carries recoverable room content.
 */

/** A room image: PNG, JPEG or WebP bytes only (no SVG, no URL), at most 2 MiB. */
export const RoomAssetUploadSchema = z
  .object({ imageBase64: z.string().min(16).max(2_900_000) })
  .strict();
export const RoomAssetUploadAck = z.object({ assetId: Uuid }).strict();

export const CLEANUP_REASONS = ['results', 'aborted', 'abandoned', 'admin', 'lobby'] as const;

/** `room.expiring` (results will be deleted) and `room.closed` (deletion started). */
export const RoomLifecycleNoticePayload = z
  .object({
    expiresAt: IsoTimestamp,
    reason: z.enum(CLEANUP_REASONS),
    /** Where the member's lasting record (medals) is. */
    profileUrl: z.string(),
  })
  .strict();

export const ROOM_LIFECYCLE_EVENT_PAYLOADS = {
  'room.expiring': RoomLifecycleNoticePayload,
  'room.closed': RoomLifecycleNoticePayload,
} as const;

export const CleanupTaskSchema = z
  .object({
    roomId: Uuid,
    gameType: z.enum(['card', 'auction']),
    lifecycle: z.string(),
    stage: z.enum(['freeze', 'assets', 'rows']),
    reason: z.enum(CLEANUP_REASONS),
    attempts: z.number().int().min(0),
    lastErrorCode: z.string().nullable(),
    nextAttemptAt: IsoTimestamp,
    /** More than 15 minutes past its due time (an operations alert). */
    overdue: z.boolean(),
  })
  .strict();

/** S33 operations cleanup queue: safe fields only, no room content. */
export const CleanupQueueSchema = z
  .object({
    tasks: z.array(CleanupTaskSchema),
    total: z.number().int().min(0),
    overdue: z.number().int().min(0),
    failing: z.number().int().min(0),
  })
  .strict();
export type CleanupQueue = z.infer<typeof CleanupQueueSchema>;

export const AdminAbortSchema = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
