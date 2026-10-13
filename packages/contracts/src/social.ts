import { z } from 'zod';
import { ProfileVisibilitySchema } from './auth';
import { MedalSummarySchema } from './profile';
import { IsoTimestamp, Uuid } from './primitives';

/**
 * Profiles, friends, blocks, member search, room invitations and the
 * personal inbox (phase 13, ADR-028). Every view is filtered on the server
 * by privacy and blocks; e-mail addresses never appear and are never searched.
 */

export const FriendshipStatusSchema = z.enum([
  'self',
  'none',
  'requested',
  'incoming',
  'friends',
  'blocked',
]);
export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

/** DB/realtime §10 ProfileDTO. Counters come from receipts only, never from a form. */
export const ProfileDTOSchema = z
  .object({
    userId: Uuid,
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    bio: z.string().nullable(),
    privacy: z.object({ visibility: ProfileVisibilitySchema, activityVisible: z.boolean() }),
    friendshipStatus: FriendshipStatusSchema,
    achievementSummary: MedalSummarySchema,
    /** Only for the owner and friends when activity is visible. */
    permittedActivity: z.object({ inRoom: z.boolean() }).nullable(),
  })
  .strict();
export type ProfileDTO = z.infer<typeof ProfileDTOSchema>;

export const ProfilePatchSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    bio: z.string().trim().max(240).nullable().optional(),
    visibility: ProfileVisibilitySchema.optional(),
    activityVisible: z.boolean().optional(),
  })
  .strict();

/** Avatar upload: PNG, JPEG or WebP bytes only (no SVG, no URL), at most 2 MiB. */
export const AvatarUploadSchema = z
  .object({ imageBase64: z.string().min(16).max(2_900_000) })
  .strict();

export const AchievementReceiptSchema = z
  .object({
    gameType: z.enum(['card', 'auction']),
    medal: z.enum(['gold', 'silver', 'bronze']).nullable(),
    rank: z.number().int().nullable(),
    scope: z.enum(['personal', 'franchise']),
    creditedRole: z.string(),
    completionDay: z.iso.date(),
  })
  .strict();

export const MemberCardSchema = z
  .object({
    userId: Uuid,
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  })
  .strict();
export type MemberCard = z.infer<typeof MemberCardSchema>;

export const MemberSearchResultSchema = z
  .object({
    members: z.array(MemberCardSchema.extend({ friendshipStatus: FriendshipStatusSchema })),
  })
  .strict();

export const FriendRequestSchema = z.object({ targetUserId: Uuid }).strict();
export const BlockRequestSchema = z.object({ targetUserId: Uuid }).strict();

export const FriendsViewSchema = z
  .object({
    friends: z.array(
      MemberCardSchema.extend({
        friendshipId: Uuid,
        since: IsoTimestamp,
        /** Present only when that friend allows activity to be seen. */
        inRoom: z.boolean().nullable(),
      }),
    ),
    incoming: z.array(MemberCardSchema.extend({ friendshipId: Uuid, at: IsoTimestamp })),
    outgoing: z.array(MemberCardSchema.extend({ friendshipId: Uuid, at: IsoTimestamp })),
    blocked: z.array(MemberCardSchema),
  })
  .strict();
export type FriendsView = z.infer<typeof FriendsViewSchema>;

export const RoomInviteRequestSchema = z.object({ friendUserId: Uuid }).strict();
export const AcceptInviteRequestSchema = z
  .object({ password: z.string().min(1).max(128).optional() })
  .strict();

export const NotificationSchema = z
  .object({
    id: Uuid,
    type: z.string(),
    /** Safe projection: names and ids, never room codes, passwords or chat. */
    payload: z.record(z.string(), z.unknown()),
    createdAt: IsoTimestamp,
    read: z.boolean(),
  })
  .strict();
export const RoomInviteSchema = z
  .object({
    inviteId: Uuid,
    roomId: Uuid,
    roomName: z.string(),
    gameType: z.enum(['card', 'auction']),
    from: MemberCardSchema,
    expiresAt: IsoTimestamp,
    needsPassword: z.boolean(),
    open: z.boolean(),
  })
  .strict();
export const NotificationsViewSchema = z
  .object({
    notifications: z.array(NotificationSchema),
    invites: z.array(RoomInviteSchema),
    unread: z.number().int(),
  })
  .strict();
export type NotificationsView = z.infer<typeof NotificationsViewSchema>;
