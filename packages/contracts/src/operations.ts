import { z } from 'zod';
import { UsernameSchema } from './auth';
import { CLEANUP_REASONS } from './cleanup';
import { IsoTimestamp, Uuid } from './primitives';

/**
 * Phase 16 (ADR-031): noncritical UI preferences and the S33 operations
 * surfaces. Nothing here grants gameplay authority; the admin read models
 * carry counts and safe fields only (no room names, members, chat, cards or
 * results).
 */

// ------------------------------------------------------------ preferences

export const MOTION_PREFERENCES = ['system', 'reduce', 'full'] as const;

export const UiPreferencesSchema = z
  .object({
    /** `system` follows the device setting; `reduce` and `full` override it. */
    motion: z.enum(MOTION_PREFERENCES),
    /** Off until the member turns it on (and the browser has had a gesture). */
    soundEffects: z.boolean(),
    /** Static portraits and no decorative effects. */
    lowData: z.boolean(),
  })
  .strict();
export type UiPreferences = z.infer<typeof UiPreferencesSchema>;

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  motion: 'system',
  soundEffects: false,
  lowData: false,
};

export const UiPreferencesPatchSchema = UiPreferencesSchema.partial()
  .strict()
  .refine((p) => Object.keys(p).length > 0, 'Change at least one preference.');

// ---------------------------------------------------------- admin overview

export const ROOM_LIFECYCLES = [
  'LOBBY',
  'RUNNING',
  'FINALIZING',
  'RESULTS',
  'PURGING',
  'ABORTED',
] as const;

export const WorkerLeaseSchema = z
  .object({
    name: z.string(),
    /** The lease is held and its heartbeat is current. */
    healthy: z.boolean(),
    heartbeatAt: IsoTimestamp,
  })
  .strict();

export const AuditEntrySchema = z
  .object({
    action: z.string(),
    targetClass: z.string(),
    actorUsername: z.string().nullable(),
    occurredAt: IsoTimestamp,
  })
  .strict();

export const AdminAnnouncementSchema = z
  .object({
    id: Uuid,
    title: z.string(),
    startsAt: IsoTimestamp,
    endsAt: IsoTimestamp,
    status: z.enum(['scheduled', 'active', 'ended', 'archived']),
  })
  .strict();

/** S33 HealthOverview + AuditPreview: aggregate, measured values only. */
export const AdminOverviewSchema = z
  .object({
    generatedAt: IsoTimestamp,
    health: z
      .object({
        database: z.boolean(),
        migration: z.string(),
        workers: z.array(WorkerLeaseSchema),
      })
      .strict(),
    rooms: z.record(z.enum(ROOM_LIFECYCLES), z.number().int().min(0)),
    liveConnections: z.number().int().min(0),
    cleanup: z
      .object({
        total: z.number().int().min(0),
        overdue: z.number().int().min(0),
        failing: z.number().int().min(0),
      })
      .strict(),
    security: z
      .object({
        /** Warning or critical security events in the last 24 hours. */
        warnings24h: z.number().int().min(0),
        suspendedUsers: z.number().int().min(0),
      })
      .strict(),
    announcements: z.array(AdminAnnouncementSchema),
    audit: z.array(AuditEntrySchema),
  })
  .strict();
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AdminRoomRowSchema = z
  .object({
    roomId: Uuid,
    gameType: z.enum(['card', 'auction']),
    lifecycle: z.enum(ROOM_LIFECYCLES),
    phase: z.string(),
    members: z.number().int().min(0),
    liveConnections: z.number().int().min(0),
    createdAt: IsoTimestamp,
    lastActivityAt: IsoTimestamp,
    /** A cleanup task exists for the room (see the cleanup queue). */
    cleanupReason: z.enum(CLEANUP_REASONS).nullable(),
  })
  .strict();

/** S33 ActiveRoomTable: no names, codes, members, chat or game state. */
export const AdminRoomsSchema = z
  .object({ rooms: z.array(AdminRoomRowSchema), total: z.number().int().min(0) })
  .strict();
export type AdminRooms = z.infer<typeof AdminRoomsSchema>;

// -------------------------------------------------- users and restrictions

export const AdminUserSchema = z
  .object({
    userId: Uuid,
    username: z.string(),
    displayName: z.string(),
    onboarded: z.boolean(),
    suspendedUntil: IsoTimestamp.nullable(),
    isAdmin: z.boolean(),
    createdAt: IsoTimestamp,
  })
  .strict();
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserLookupQuery = z.object({ username: UsernameSchema }).strict();

/** Suspend until a time (at most a year ahead), or lift with `null`. */
export const AdminRestrictionSchema = z
  .object({
    suspendedUntil: IsoTimestamp.nullable(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();

export const AnnouncementCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(1000),
    startsAt: IsoTimestamp,
    endsAt: IsoTimestamp,
  })
  .strict()
  .refine((a) => Date.parse(a.startsAt) < Date.parse(a.endsAt), {
    message: 'The end must be after the start.',
    path: ['endsAt'],
  });
