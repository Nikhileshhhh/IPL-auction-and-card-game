import { z } from 'zod';
import { IsoTimestamp, Uuid } from './primitives';
import { RaritySchema } from './rooms';

/**
 * Catalog DTOs (phase 06, ADR-017/ADR-018/ADR-022). Cards carry the three
 * Attax stats: Batting and Bowling ratings (whole numbers 0–100 from IPL
 * careers; Bronze ≤ 89, legends' Gold skill 90–100) and Runs (career runs per
 * innings, a real figure). These are also the game's categories.
 */
export const CARD_METRICS = ['batting', 'bowling', 'runs'] as const;
export const CardMetricSchema = z.enum(CARD_METRICS);
export type CardMetric = z.infer<typeof CardMetricSchema>;

export const METRIC_LABELS: Record<CardMetric, string> = {
  batting: 'Batting',
  bowling: 'Bowling',
  runs: 'Runs',
};

export const PlayerRoleSchema = z.enum(['batter', 'bowler', 'all_rounder', 'wicketkeeper']);
export type PlayerRole = z.infer<typeof PlayerRoleSchema>;

export const ROLE_LABELS: Record<PlayerRole, string> = {
  batter: 'Batter',
  bowler: 'Bowler',
  all_rounder: 'All-rounder',
  wicketkeeper: 'Wicketkeeper',
};

/**
 * Highest displayed rating. The model tops out at 100; only a product-owner
 * override may show 101 (Sachin Tendulkar's Gold card, ADR-022 amendment).
 */
export const RATING_MAX = 101;
const Rating = z.number().int().min(0).max(RATING_MAX);
export const CardRatingsSchema = z
  .object({
    batting: Rating,
    bowling: Rating,
    /** Career runs per innings (whole runs). */
    runs: Rating,
  })
  .strict();
export type CardRatings = z.infer<typeof CardRatingsSchema>;

/** Credit for a freely licensed or licensed photo (shown in the card detail). */
export const PhotoCreditSchema = z
  .object({
    author: z.string(),
    licence: z.string(),
    licenceUrl: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    attribution: z.string(),
  })
  .strict();
export type PhotoCredit = z.infer<typeof PhotoCreditSchema>;

/** One identity on a card. portraitUrl is mandatory (ADR-017). */
export const PublicCardPlayerSchema = z
  .object({
    id: Uuid,
    name: z.string(),
    role: PlayerRoleSchema,
    team: z.string().nullable(),
    /**
     * ISO 3166 alpha-2. Published cards always carry country and batting style
     * (publish gate, ADR-019); null only appears in unpublished admin drafts.
     */
    country: z.string().nullable(),
    battingStyle: z.enum(['right_hand', 'left_hand']).nullable(),
    /** null = the player does not bowl (never bowled in the data window). */
    bowlingStyle: z.string().nullable(),
    /** Photo of the player in IPL franchise jersey (mandatory, ADR-019). */
    portraitUrl: z.string().min(1),
    portraitAlt: z.string(),
    photoCredit: PhotoCreditSchema.nullable(),
  })
  .strict();
export type PublicCardPlayer = z.infer<typeof PublicCardPlayerSchema>;

export const PublicCardSchema = z
  .object({
    definitionId: Uuid,
    rarity: RaritySchema,
    stars: z.number().int().min(1).max(5),
    players: z.array(PublicCardPlayerSchema).min(1).max(2),
    ratings: CardRatingsSchema,
    dataLabel: z.string(),
    dataKind: z.enum(['demo', 'factual']),
    modelVersion: z.string(),
  })
  .strict();
export type PublicCardDTO = z.infer<typeof PublicCardSchema>;

const nullableInt = z.number().int().nullable();
/** Unweighted raw statistics for the scope in `scopeLabel` (x100 values are fixed-point). */
export const RawStatsSchema = z
  .object({
    scopeLabel: z.string(),
    matches: z.number().int(),
    innings: z.number().int(),
    runs: z.number().int(),
    ballsFaced: z.number().int(),
    notOuts: z.number().int(),
    fours: z.number().int(),
    sixes: z.number().int(),
    highScore: nullableInt,
    battingAverageX100: nullableInt,
    strikeRateX100: nullableInt,
    ballsBowled: z.number().int(),
    runsConceded: z.number().int(),
    wickets: z.number().int(),
    economyX100: nullableInt,
    bowlingAverageX100: nullableInt,
    bestBowling: z.object({ wickets: z.number().int(), runs: z.number().int() }).nullable(),
    catches: z.number().int(),
    runOuts: z.number().int(),
    stumpings: z.number().int(),
  })
  .strict();
export type RawStatsDTO = z.infer<typeof RawStatsSchema>;

export const CardDetailSchema = z
  .object({
    card: PublicCardSchema,
    players: z.array(
      z
        .object({
          playerId: Uuid,
          raw: RawStatsSchema.nullable(),
          phases: z.record(z.string(), Rating),
        })
        .strict(),
    ),
    source: z.object({ publisher: z.string(), licence: z.string(), url: z.string() }).strict(),
  })
  .strict();
export type CardDetailDTO = z.infer<typeof CardDetailSchema>;

export const CatalogPageSchema = z
  .object({
    dataVersionId: Uuid,
    dataLabel: z.string(),
    items: z.array(PublicCardSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type CatalogPageDTO = z.infer<typeof CatalogPageSchema>;

// ------------------------------------------------------------------ admin

export const CatalogImportRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('demo'),
      label: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cricsheet'),
      label: z.string().trim().min(1).max(60),
      /** Last season of the three-season window (defaults to the newest in the archive). */
      latestSeason: z.number().int().min(2008).max(2100).optional(),
    })
    .strict(),
]);
export type CatalogImportRequest = z.infer<typeof CatalogImportRequestSchema>;

export const PlayerCorrectionSchema = z
  .object({
    canonicalName: z.string().trim().min(1).max(80).optional(),
    role: PlayerRoleSchema.optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .optional(),
    battingStyle: z.enum(['right_hand', 'left_hand']).nullable().optional(),
    bowlingStyle: z.string().trim().max(40).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });

export const MediaReviewSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(300).optional(),
  })
  .strict();

export const AdminPlayerRowSchema = z
  .object({
    playerId: Uuid,
    name: z.string(),
    role: PlayerRoleSchema,
    roleReviewed: z.boolean(),
    country: z.string().nullable(),
    battingStyle: z.enum(['right_hand', 'left_hand']).nullable(),
    bowlingStyle: z.string().nullable(),
    /** Bowled at least one ball in the data window (bowling style then required). */
    bowls: z.boolean(),
    team: z.string().nullable(),
    portrait: z
      .object({
        assetId: Uuid,
        status: z.enum(['pending', 'approved', 'rejected', 'expired']),
        basis: z.string(),
        credit: z.string().nullable(),
        iplKit: z.boolean(),
      })
      .nullable(),
    /** Facts and photo still needed before this player's card can be published. */
    missing: z.array(z.enum(['photo', 'ipl_kit', 'country', 'batting_style', 'bowling_style'])),
    ratings: CardRatingsSchema.nullable(),
  })
  .strict();
export type AdminPlayerRow = z.infer<typeof AdminPlayerRowSchema>;

export const DataVersionSummarySchema = z
  .object({
    id: Uuid,
    label: z.string(),
    kind: z.enum(['demo', 'factual']),
    status: z.enum(['draft', 'published', 'archived']),
    windowLabel: z.string().nullable(),
    players: z.number().int(),
    cards: z.number().int(),
    withPortrait: z.number().int(),
    publishedAt: IsoTimestamp.nullable(),
    validation: z
      .object({
        ok: z.boolean(),
        problems: z.array(
          z.object({ code: z.string(), message: z.string(), count: z.number().int() }),
        ),
      })
      .nullable(),
  })
  .strict();
export type DataVersionSummary = z.infer<typeof DataVersionSummarySchema>;

/** Max upload size (decoded bytes) and base64 bound for JSON transport. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export const AdminMediaUploadSchema = z
  .object({
    playerId: Uuid,
    /** PNG/JPEG/WebP bytes, base64 (≤ 2 MiB decoded). Re-encoded server-side. */
    imageBase64: z
      .string()
      .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    rights: z
      .object({
        basis: z.enum(['licensed', 'free-license']),
        licence: z.string().trim().min(2).max(80),
        author: z.string().trim().min(1).max(200),
        attribution: z.string().trim().min(1).max(300),
        /** Where the photo came from (required for free-licence photos). */
        sourceUrl: z
          .url()
          .max(500)
          .refine((u) => u.startsWith('https://'), 'https only')
          .optional(),
        licenceUrl: z
          .url()
          .max(300)
          .refine((u) => u.startsWith('https://'), 'https only')
          .optional(),
        expiresAt: IsoTimestamp.optional(),
      })
      .strict()
      .refine((r) => r.basis !== 'free-license' || !!r.sourceUrl, {
        message: 'Free-licence photos need their source page',
        path: ['sourceUrl'],
      }),
    /** The uploader confirms the player is wearing the IPL franchise jersey (ADR-019). */
    iplKit: z.literal(true),
  })
  .strict();
export type AdminMediaUpload = z.infer<typeof AdminMediaUploadSchema>;

export const PublishRequestSchema = z
  .object({
    /** Leave out cards whose player has no approved photo (reported, never silent). */
    prune: z.boolean().default(false),
  })
  .strict();
