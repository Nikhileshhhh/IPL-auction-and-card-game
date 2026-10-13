import type {
  PermittedSnapshotDTO,
  RoomLobbyDTO,
  RoomMemberSummary,
  StreamCursor,
} from '@stumps/contracts';
import { AppError } from '../http/app-error';
import type { Tx } from '../db/transaction';
import type { Secrets } from '../config/secrets';
import { openRoomCode } from './codes';
import type { RoomRow } from './room-tx';

export interface MemberRow {
  id: string;
  user_id: string;
  seat: number | null;
  role: 'player' | 'spectator';
  ready: boolean;
  left_at: Date | null;
  joined_at: Date;
  control_epoch: string;
  username: string;
  display_name: string;
  online: boolean;
}

export async function listMembers(tx: Tx, roomId: string): Promise<MemberRow[]> {
  const res = await tx.query<MemberRow>(
    `SELECT m.id, m.user_id, m.seat, m.role, m.ready, m.left_at, m.joined_at, m.control_epoch::text,
            p.username, p.display_name,
            EXISTS (SELECT 1 FROM app_private.room_connections c
                     WHERE c.room_id = m.room_id AND c.member_id = m.id AND c.expires_at > now()) AS online
       FROM app_private.room_members m JOIN app_private.profiles p ON p.user_id = m.user_id
      WHERE m.room_id = $1 AND m.left_at IS NULL
      ORDER BY m.joined_at, m.id`,
    [roomId],
  );
  return res.rows;
}

/** Room membership is the resource ACL; non-members get a concealed NOT_FOUND. */
export async function requireMembership(
  tx: Tx,
  roomId: string,
  userId: string,
): Promise<MemberRow> {
  const member = (await listMembers(tx, roomId)).find((m) => m.user_id === userId);
  if (!member) throw new AppError('NOT_FOUND', 'Room not found.');
  return member;
}

function ruleLabels(room: RoomRow): string[] {
  const s = room.settings;
  if (room.game_type === 'card') {
    return [
      `Up to ${String(s.maxPlayers)} players`,
      `${String(s.totalCards)} cards`,
      `${String(s.selectionSeconds)} s to choose`,
      s.matchMinutes ? `${String(s.matchMinutes)} min match limit` : 'No match time limit',
      `Tie fallback after ${String(s.tieCap)} ties`,
      s.dealMode === 'random' ? 'Pure random deal (casual)' : 'Stratified fair deal',
    ];
  }
  return [
    'Real IPL mega-auction rules (2025–27)',
    s.format === 'retention' ? 'Retention format' : 'Fresh reset format (simulator option)',
    `${String(s.franchiseCount)} franchises`,
    `Up to ${String(s.collaboratorsPerFranchise)} people per franchise`,
    `${String(s.openingClockSeconds)} s opening clock`,
  ];
}

export function summarize(member: MemberRow, hostUserId: string): RoomMemberSummary {
  return {
    id: member.id,
    username: member.username,
    displayName: member.display_name,
    connectionStatus: member.online ? 'online' : 'offline',
    seat: member.seat,
    ready: member.ready,
    role: member.role,
    isHost: member.user_id === hostUserId,
  };
}

export async function lobbyProjection(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  viewerUserId: string,
): Promise<RoomLobbyDTO> {
  const members = await listMembers(tx, room.id);
  const me = members.find((m) => m.user_id === viewerUserId);
  if (!me) throw new AppError('NOT_FOUND', 'Room not found.');
  const host = members.find((m) => m.user_id === room.host_user_id) ?? me;
  const isHost = room.host_user_id === viewerUserId;
  const lobbyOpen = room.lifecycle === 'LOBBY';
  return {
    roomId: room.id,
    gameType: room.game_type,
    name: room.name,
    hostMemberId: host.id,
    configVersion: room.config_version,
    stateVersion: room.state_version,
    lifecycle: room.lifecycle,
    phase: room.phase,
    settings: room.settings,
    ruleLabels: ruleLabels(room),
    members: members.map((m) => summarize(m, room.host_user_id)),
    myCapabilities: [
      me.role,
      ...(isHost ? ['host'] : []),
      ...(isHost && lobbyOpen ? ['settings', 'start', 'kick'] : []),
    ],
    myMembershipId: me.id,
    // Authorized display of the invitation code to current members only.
    ...(lobbyOpen || room.lifecycle === 'RUNNING'
      ? { roomCode: openRoomCode(secrets, room.id, room.code_ciphertext) }
      : {}),
    passwordProtected: room.password_hash !== null,
    expiresAt: room.expires_at.toISOString(),
  };
}

/**
 * Stream ACL (DB/realtime §3.1) as SQL over room_streams columns: the public
 * stream, the viewer's own member stream, and the stream of the auction team
 * the viewer is an approved member of. `member` is the parameter holding the
 * viewer's membership ID (e.g. "$2").
 */
export const streamAcl = (member: string) =>
  `(audience_kind = 'public'
    OR (audience_kind = 'member' AND audience_id = ${member})
    OR (audience_kind = 'team' AND audience_id IN (
          SELECT fm.auction_franchise_id FROM app_private.franchise_members fm
           WHERE fm.member_id = ${member})))`;

/**
 * Streams the viewer may read right now (public, own member stream, own team
 * stream). Pure read: streams are created with the room, membership or team,
 * so snapshots can run in READ ONLY transactions.
 */
export async function permittedStreams(
  tx: Tx,
  roomId: string,
  memberId: string,
): Promise<string[]> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM app_private.room_streams
      WHERE room_id = $1 AND ${streamAcl('$2')}
      ORDER BY audience_kind DESC, id`,
    [roomId, memberId],
  );
  return res.rows.map((r) => r.id);
}

export async function cursorsFor(tx: Tx, streamIds: readonly string[]): Promise<StreamCursor[]> {
  const res = await tx.query<{ id: string; seq: string }>(
    'SELECT id, seq::text FROM app_private.room_streams WHERE id = ANY($1::uuid[]) ORDER BY id',
    [streamIds],
  );
  return res.rows.map((r) => ({ streamId: r.id, seq: r.seq }));
}

export type GameProjector = (tx: Tx, room: RoomRow, member: MemberRow) => Promise<unknown>;

export async function buildSnapshot(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  member: MemberRow,
  now: Date,
  gameProjector?: GameProjector,
  /** The requesting tab's socket; HTTP-only viewers control when no tab holds control. */
  socketId?: string,
): Promise<PermittedSnapshotDTO & { streamIds: string[] }> {
  const streamIds = await permittedStreams(tx, room.id, member.id);
  const lobby = await lobbyProjection(tx, secrets, room, member.user_id);
  const controller = await tx.query<{ socket_id: string }>(
    'SELECT socket_id FROM app_private.room_connections WHERE member_id = $1 AND is_controller AND expires_at > $2',
    [member.id, now],
  );
  const controllerSocket = controller.rows[0]?.socket_id;
  const isController = socketId ? controllerSocket === socketId : controllerSocket === undefined;
  const handover = await tx.query<{ id: string; from_member_id: string; expires_at: Date }>(
    `SELECT id, from_member_id, expires_at FROM app_private.host_handovers
      WHERE room_id = $1 AND to_member_id = $2 AND status = 'pending' AND expires_at > $3`,
    [room.id, member.id, now],
  );
  const pending = handover.rows[0];
  return {
    room: lobby,
    me: {
      memberId: member.id,
      controlEpoch: member.control_epoch,
      capabilities: lobby.myCapabilities,
      isController,
    },
    game: gameProjector ? await gameProjector(tx, room, member) : null,
    pendingHostHandover: pending
      ? {
          handoverId: pending.id,
          fromMemberId: pending.from_member_id,
          expiresAt: pending.expires_at.toISOString(),
        }
      : null,
    cursors: await cursorsFor(tx, streamIds),
    recoveryUntil:
      room.recovery_until && room.recovery_until.getTime() > now.getTime()
        ? room.recovery_until.toISOString()
        : null,
    serverNow: now.toISOString(),
    streamIds,
  };
}

export const REPLAY_LIMIT = 500;
export const REPLAY_BYTES = 256 * 1024;

export interface StoredEvent {
  eventId: string;
  schemaVersion: number;
  type: string;
  streamId: string;
  seq: string;
  roomStateVersion: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** Replay after a cursor; too many or too large → fresh snapshot required. */
export async function replay(tx: Tx, streamId: string, afterSeq: string) {
  const res = await tx.query<{
    id: string;
    schema_version: number;
    type: string;
    stream_id: string;
    seq: string;
    state_version: string;
    created_at: Date;
    payload: Record<string, unknown>;
    bytes: number;
  }>(
    `SELECT id, schema_version, type, stream_id, seq::text, state_version::text, created_at, payload,
            octet_length(payload::text) AS bytes
       FROM app_private.room_events WHERE stream_id = $1 AND seq > $2 ORDER BY seq LIMIT ${REPLAY_LIMIT + 1}`,
    [streamId, afterSeq],
  );
  const total = res.rows.reduce((n, r) => n + r.bytes, 0);
  if (res.rows.length > REPLAY_LIMIT || total > REPLAY_BYTES) {
    return { events: [] as StoredEvent[], snapshotRequired: true as const };
  }
  return { events: res.rows.map(toEnvelope), snapshotRequired: false as const };
}

export function toEnvelope(r: {
  id: string;
  schema_version: number;
  type: string;
  stream_id: string;
  seq: string;
  state_version: string;
  created_at: Date;
  payload: Record<string, unknown>;
}): StoredEvent {
  return {
    eventId: r.id,
    schemaVersion: r.schema_version,
    type: r.type,
    streamId: r.stream_id,
    seq: r.seq,
    roomStateVersion: r.state_version,
    occurredAt: r.created_at.toISOString(),
    payload: r.payload,
  };
}
