import { z } from 'zod';
import { Uuid } from './primitives';

export const MedalKindSchema = z.enum(['gold', 'silver', 'bronze']);
export type MedalKind = z.infer<typeof MedalKindSchema>;

export const MedalSummarySchema = z
  .object({
    gold: z.number().int().min(0),
    silver: z.number().int().min(0),
    bronze: z.number().int().min(0),
    games: z.number().int().min(0),
    cardWins: z.number().int().min(0),
    auctionWins: z.number().int().min(0),
  })
  .strict();
export type MedalSummary = z.infer<typeof MedalSummarySchema>;

export const MemberSummarySchema = z
  .object({
    profile: z.object({ userId: Uuid, username: z.string(), displayName: z.string() }).strict(),
    medals: MedalSummarySchema,
    recentMedals: z.array(
      z
        .object({
          medal: MedalKindSchema,
          gameType: z.enum(['card', 'auction']),
          scope: z.enum(['personal', 'franchise']),
          completionDay: z.iso.date(),
        })
        .strict(),
    ),
    friends: z
      .object({ accepted: z.number().int().min(0), pendingIncoming: z.number().int().min(0) })
      .strict(),
  })
  .strict();
export type MemberSummaryDTO = z.infer<typeof MemberSummarySchema>;

export const AnnouncementSchema = z
  .object({
    id: Uuid,
    title: z.string(),
    body: z.string(),
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .strict();
export type Announcement = z.infer<typeof AnnouncementSchema>;
