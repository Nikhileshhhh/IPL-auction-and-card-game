import type { EventType } from '@stumps/contracts';
import type { Tx } from '../db/transaction';
import { one } from '../db/rows';

export type Audience =
  { kind: 'public' } | { kind: 'member'; memberId: string } | { kind: 'team'; franchiseId: string };

export interface EventDraft {
  audience: Audience;
  type: EventType;
  payload: Record<string, unknown>;
}

function audienceKey(audience: Audience): [string, string | null] {
  if (audience.kind === 'public') return ['public', null];
  if (audience.kind === 'member') return ['member', audience.memberId];
  return ['team', audience.franchiseId];
}

/** Find or create the ordered stream for an audience (DB/realtime §3.1). */
export async function streamFor(tx: Tx, roomId: string, audience: Audience): Promise<string> {
  const [kind, id] = audienceKey(audience);
  await tx.query(
    `INSERT INTO app_private.room_streams (room_id, audience_kind, audience_id) VALUES ($1, $2, $3)
     ON CONFLICT (room_id, audience_kind, audience_id) DO NOTHING`,
    [roomId, kind, id],
  );
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM app_private.room_streams
      WHERE room_id = $1 AND audience_kind = $2 AND audience_id IS NOT DISTINCT FROM $3`,
    [roomId, kind, id],
  );
  return one(res).id;
}

/**
 * Append events in the caller's room transaction. Each audience has its own
 * contiguous sequence, so private events never create gaps in public streams.
 * Must be called while holding the room lock.
 */
export async function appendEvents(
  tx: Tx,
  roomId: string,
  stateVersion: string,
  drafts: readonly EventDraft[],
) {
  for (const draft of drafts) {
    const streamId = await streamFor(tx, roomId, draft.audience);
    const seq = one(
      await tx.query<{ seq: string }>(
        'UPDATE app_private.room_streams SET seq = seq + 1 WHERE id = $1 RETURNING seq::text',
        [streamId],
      ),
    ).seq;
    await tx.query(
      `INSERT INTO app_private.room_events (room_id, stream_id, seq, state_version, type, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [roomId, streamId, seq, stateVersion, draft.type, JSON.stringify(draft.payload)],
    );
  }
}
