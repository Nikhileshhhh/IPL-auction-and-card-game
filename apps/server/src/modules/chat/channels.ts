import type { ChatChannel, ChatChannelKind } from '@stumps/contracts';
import type { Tx } from '../../db/transaction';
import { AppError } from '../../http/app-error';
import type { MemberRow } from '../../rooms/projection';
import type { RoomRow } from '../../rooms/room-tx';
import type { Audience } from '../../rooms/streams';

/**
 * Chat channels (DB/realtime §5.2, ADR-028). The room channel is for every
 * member of the room; a team channel exists only in auctions and only that
 * franchise's approved members may read, send or replay it. Every check is
 * made here on the server, never by hiding UI.
 */

export interface ChannelRow {
  id: string;
  room_id: string;
  kind: ChatChannelKind;
  franchise_id: string | null;
}

export const audienceOf = (c: ChannelRow): Audience =>
  c.kind === 'team' && c.franchise_id
    ? { kind: 'team', franchiseId: c.franchise_id }
    : { kind: 'public' };

async function teamOf(tx: Tx, roomId: string, memberId: string) {
  const res = await tx.query<{ auction_franchise_id: string; role: string }>(
    'SELECT auction_franchise_id, role FROM app_private.franchise_members WHERE room_id = $1 AND member_id = $2',
    [roomId, memberId],
  );
  return res.rows[0] ?? null;
}

async function ensure(tx: Tx, roomId: string, kind: ChatChannelKind, franchiseId: string | null) {
  await tx.query(
    `INSERT INTO app_private.chat_channels (room_id, kind, franchise_id) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [roomId, kind, franchiseId],
  );
  const res = await tx.query<ChannelRow>(
    `SELECT id, room_id, kind, franchise_id FROM app_private.chat_channels
      WHERE room_id = $1 AND kind = $2 AND franchise_id IS NOT DISTINCT FROM $3`,
    [roomId, kind, franchiseId],
  );
  return res.rows[0] as ChannelRow;
}

function requireOpenRoom(room: RoomRow) {
  if (room.lifecycle === 'PURGING' || room.lifecycle === 'ABORTED') {
    throw new AppError('ROOM_GONE', 'This room no longer exists.');
  }
}

/** The viewer's channel of a kind: the room channel, or their own team's. */
export async function channelFor(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
  kind: ChatChannelKind,
): Promise<ChannelRow> {
  requireOpenRoom(room);
  if (kind === 'room') return ensure(tx, room.id, 'room', null);
  const team = room.game_type === 'auction' ? await teamOf(tx, room.id, member.id) : null;
  if (!team) throw new AppError('CHAT_FORBIDDEN', 'Team chat is only for members of a team.');
  return ensure(tx, room.id, 'team', team.auction_franchise_id);
}

/** A channel by id that this member may use; anything else is concealed. */
export async function authorizedChannel(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
  channelId: string,
): Promise<ChannelRow> {
  requireOpenRoom(room);
  const res = await tx.query<ChannelRow>(
    'SELECT id, room_id, kind, franchise_id FROM app_private.chat_channels WHERE id = $1 AND room_id = $2',
    [channelId, room.id],
  );
  const channel = res.rows[0];
  if (!channel) throw new AppError('CHAT_FORBIDDEN', 'You cannot use this chat.');
  if (channel.kind === 'team') {
    const team = await teamOf(tx, room.id, member.id);
    if (team?.auction_franchise_id !== channel.franchise_id) {
      throw new AppError('CHAT_FORBIDDEN', 'You cannot use this chat.');
    }
  }
  return channel;
}

/** Host moderates the room channel; the captain moderates their own team channel. */
export async function canModerate(tx: Tx, room: RoomRow, member: MemberRow, channel: ChannelRow) {
  if (channel.kind === 'room') return room.host_user_id === member.user_id;
  const team = await teamOf(tx, room.id, member.id);
  return team?.auction_franchise_id === channel.franchise_id && team?.role === 'captain';
}

export async function mutedUntil(tx: Tx, channelId: string, memberId: string, now: Date) {
  const res = await tx.query<{ expires_at: Date }>(
    'SELECT expires_at FROM app_private.chat_mutes WHERE channel_id = $1 AND member_id = $2 AND expires_at > $3',
    [channelId, memberId, now],
  );
  return res.rows[0]?.expires_at ?? null;
}

/** History for a channel the viewer may read (latest 100, oldest first). */
export async function channelView(
  tx: Tx,
  room: RoomRow,
  member: MemberRow,
  kind: ChatChannelKind,
  now: Date,
): Promise<ChatChannel> {
  const channel = await channelFor(tx, room, member, kind);
  const messages = await tx.query<{
    id: string;
    sender_member_id: string;
    display_name: string;
    body: string;
    created_at: Date;
    removed: boolean;
  }>(
    `SELECT * FROM (
       SELECT c.id, c.sender_member_id, p.display_name, c.body, c.created_at, c.removed_at IS NOT NULL AS removed
         FROM app_private.chat_messages c
         JOIN app_private.room_members m ON m.id = c.sender_member_id
         JOIN app_private.profiles p ON p.user_id = m.user_id
        WHERE c.channel_id = $1
        ORDER BY c.created_at DESC, c.id DESC LIMIT 100) recent
      ORDER BY created_at, id`,
    [channel.id],
  );
  let label = 'Everyone in this room';
  let members: ChatChannel['members'] = null;
  if (channel.kind === 'team' && channel.franchise_id) {
    const team = await tx.query<{ name: string }>(
      `SELECT f.name FROM app_private.auction_franchises af JOIN app_private.franchises f ON f.id = af.franchise_id
        WHERE af.id = $1`,
      [channel.franchise_id],
    );
    label = `Only ${team.rows[0]?.name ?? 'your team'} members`;
    members = (
      await tx.query<{ member_id: string; display_name: string }>(
        `SELECT fm.member_id, p.display_name FROM app_private.franchise_members fm
           JOIN app_private.room_members m ON m.id = fm.member_id
           JOIN app_private.profiles p ON p.user_id = m.user_id
          WHERE fm.auction_franchise_id = $1 ORDER BY (fm.role = 'captain') DESC, p.display_name`,
        [channel.franchise_id],
      )
    ).rows.map((m) => ({ memberId: m.member_id, displayName: m.display_name }));
  }
  const muted = await mutedUntil(tx, channel.id, member.id, now);
  return {
    channelId: channel.id,
    kind: channel.kind,
    audienceLabel: label,
    members,
    messages: messages.rows.map((m) => ({
      messageId: m.id,
      sender: { memberId: m.sender_member_id, displayName: m.display_name },
      text: m.removed ? '' : m.body,
      removed: m.removed,
      createdAt: m.created_at.toISOString(),
      mine: m.sender_member_id === member.id,
    })),
    canSend: muted === null,
    mutedUntil: muted ? muted.toISOString() : null,
    canModerate: await canModerate(tx, room, member, channel),
  };
}
