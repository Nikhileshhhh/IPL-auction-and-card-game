import { z } from 'zod';
import { DecimalString, IsoTimestamp, Uuid } from './primitives';

/** Crockford-style Base32 alphabet (no I, L, O, U): 12 symbols = 60 bits. */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 12;

/** Normalize typed/pasted codes: case, spaces, hyphens, and ambiguous letters. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function formatRoomCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export const RoomCodeSchema = z
  .string()
  .max(40)
  .transform(normalizeRoomCode)
  .pipe(
    z
      .string()
      .regex(new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`), 'Invalid room code'),
  );

export const RARITIES = [
  'normal',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'dual_platinum',
] as const;
export const RaritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof RaritySchema>;

/** Card room settings (rules §1). Divisibility by seated players is checked at start (E40). */
export const CardSettingsSchema = z
  .object({
    maxPlayers: z.number().int().min(2).max(8).default(4),
    totalCards: z.number().int().min(8).max(240).default(48),
    selectionSeconds: z.number().int().min(10).max(60).default(20),
    matchMinutes: z.number().int().min(10).max(120).nullable().default(45),
    rarities: z
      .array(RaritySchema)
      .min(1)
      .max(6)
      .default([...RARITIES]),
    dealMode: z.enum(['stratified', 'random']).default('stratified'),
    tieCap: z.number().int().min(4).max(30).default(12),
    resultsSeconds: z.number().int().min(30).max(300).default(120),
  })
  .strict()
  .refine((s) => new Set(s.rarities).size === s.rarities.length, { message: 'Duplicate rarities' });
export type CardSettings = z.infer<typeof CardSettingsSchema>;

/**
 * Auction room settings. The rules are the real IPL mega-auction rules
 * (ADR-024), bound at creation to the published pool of the current data pack;
 * the host chooses the format and how many teams and people may take part.
 */
export const AuctionSettingsSchema = z
  .object({
    preset: z.enum(['IPL_MEGA_RULES_2025_27']).default('IPL_MEGA_RULES_2025_27'),
    format: z.enum(['fresh', 'retention']).default('retention'),
    franchiseCount: z.number().int().min(2).max(10).default(4),
    collaboratorsPerFranchise: z.number().int().min(1).max(6).default(4),
    openingClockSeconds: z.number().int().min(10).max(60).default(20),
    rtmStageSeconds: z.number().int().min(10).max(30).default(15),
    resultsSeconds: z.number().int().min(30).max(300).default(120),
  })
  .strict();
export type AuctionSettings = z.infer<typeof AuctionSettingsSchema>;

export const GameTypeSchema = z.enum(['card', 'auction']);
export type GameType = z.infer<typeof GameTypeSchema>;

export const RoomNameSchema = z.string().trim().min(1).max(64);
export const RoomPasswordSchema = z.string().min(4).max(128);

export const CreateRoomRequestSchema = z.discriminatedUnion('gameType', [
  z
    .object({
      gameType: z.literal('card'),
      name: RoomNameSchema,
      password: RoomPasswordSchema.optional(),
      settings: CardSettingsSchema,
    })
    .strict(),
  z
    .object({
      gameType: z.literal('auction'),
      name: RoomNameSchema,
      password: RoomPasswordSchema.optional(),
      settings: AuctionSettingsSchema,
    })
    .strict(),
]);
export type CreateRoomRequest = z.input<typeof CreateRoomRequestSchema>;

export const JoinRoomRequestSchema = z
  .object({
    code: RoomCodeSchema,
    password: z.string().max(128).optional(),
    gameType: GameTypeSchema,
  })
  .strict();

export const ReadyRequestSchema = z
  .object({ ready: z.boolean(), configVersion: DecimalString })
  .strict();
export const SettingsPatchRequestSchema = z
  .object({ patch: z.record(z.string(), z.unknown()), configVersion: DecimalString })
  .strict();
export const StartRequestSchema = z.object({ configVersion: DecimalString }).strict();
export const KickRequestSchema = z.object({ memberId: Uuid }).strict();
export const HostTransferRequestSchema = z.object({ memberId: Uuid }).strict();
/** deviceId is the requesting tab's live socket ID (it must already be connected to this room). */
export const ControlRequestSchema = z
  .object({ currentEpoch: DecimalString, deviceId: z.string().min(1).max(64) })
  .strict();
export const EventsQuerySchema = z.object({ streamId: Uuid, afterSeq: DecimalString }).strict();

export const ConnectionStatusSchema = z.enum(['online', 'offline']);

export const RoomMemberSummarySchema = z
  .object({
    id: Uuid,
    username: z.string(),
    displayName: z.string(),
    connectionStatus: ConnectionStatusSchema,
    seat: z.number().int().nullable(),
    ready: z.boolean(),
    role: z.enum(['player', 'spectator']),
    isHost: z.boolean(),
  })
  .strict();
export type RoomMemberSummary = z.infer<typeof RoomMemberSummarySchema>;

export const LifecycleSchema = z.enum([
  'LOBBY',
  'RUNNING',
  'FINALIZING',
  'RESULTS',
  'PURGING',
  'ABORTED',
]);

export const RoomLobbySchema = z
  .object({
    roomId: Uuid,
    gameType: GameTypeSchema,
    name: z.string(),
    hostMemberId: Uuid,
    configVersion: DecimalString,
    stateVersion: DecimalString,
    lifecycle: LifecycleSchema,
    phase: z.string(),
    settings: z.record(z.string(), z.unknown()),
    ruleLabels: z.array(z.string()),
    members: z.array(RoomMemberSummarySchema),
    myCapabilities: z.array(z.string()),
    myMembershipId: Uuid,
    roomCode: z.string().optional(),
    passwordProtected: z.boolean(),
    expiresAt: IsoTimestamp,
  })
  .strict();
export type RoomLobbyDTO = z.infer<typeof RoomLobbySchema>;

export const StreamCursorSchema = z.object({ streamId: Uuid, seq: DecimalString }).strict();
export type StreamCursor = z.infer<typeof StreamCursorSchema>;

export const PermittedSnapshotSchema = z
  .object({
    room: RoomLobbySchema,
    me: z
      .object({
        memberId: Uuid,
        controlEpoch: DecimalString,
        capabilities: z.array(z.string()),
        isController: z.boolean(),
      })
      .strict(),
    game: z.unknown().nullable(),
    pendingHostHandover: z
      .object({ handoverId: Uuid, fromMemberId: Uuid, expiresAt: IsoTimestamp })
      .strict()
      .nullable(),
    cursors: z.array(StreamCursorSchema),
    serverNow: IsoTimestamp,
  })
  .strict();
export type PermittedSnapshotDTO = z.infer<typeof PermittedSnapshotSchema>;

export const ReplayResponseSchema = z.union([
  z.object({ events: z.array(z.unknown()), snapshotRequired: z.literal(false) }).strict(),
  z.object({ events: z.array(z.unknown()).max(0), snapshotRequired: z.literal(true) }).strict(),
]);
