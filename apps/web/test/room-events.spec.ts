import { describe, expect, it } from 'vitest';
import type { PermittedSnapshotDTO } from '@stumps/contracts';
import { applyEvent, fromSnapshot, type RoomEvent } from '../features/room/events';
import { evenDealCounts } from '../features/room/rules';

const PUBLIC = '00000000-0000-4000-8000-000000000001';
const PRIVATE = '00000000-0000-4000-8000-000000000002';
const HOST = '00000000-0000-4000-8000-0000000000a1';
const GUEST = '00000000-0000-4000-8000-0000000000b2';

function snapshot(): PermittedSnapshotDTO {
  return {
    room: {
      roomId: '00000000-0000-4000-8000-0000000000ff',
      gameType: 'card',
      name: 'Test',
      hostMemberId: HOST,
      configVersion: '1',
      stateVersion: '0',
      lifecycle: 'LOBBY',
      phase: 'LOBBY',
      settings: { maxPlayers: 4 },
      ruleLabels: [],
      members: [
        {
          id: HOST,
          username: 'host',
          displayName: 'Host',
          connectionStatus: 'online',
          seat: 0,
          ready: true,
          role: 'player',
          isHost: true,
        },
      ],
      myCapabilities: ['player', 'host'],
      myMembershipId: HOST,
      passwordProtected: false,
      expiresAt: '2026-10-10T12:00:00.000Z',
    },
    me: { memberId: HOST, controlEpoch: '0', capabilities: [], isController: true },
    game: null,
    pendingHostHandover: null,
    cursors: [
      { streamId: PUBLIC, seq: '3' },
      { streamId: PRIVATE, seq: '0' },
    ],
    recoveryUntil: null,
    serverNow: '2026-10-10T10:00:00.000Z',
  };
}

const event = (
  seq: string,
  type: string,
  payload: Record<string, unknown>,
  streamId = PUBLIC,
): RoomEvent => ({
  eventId: `e${seq}`,
  type,
  streamId,
  seq,
  roomStateVersion: '0',
  occurredAt: '2026-10-10T10:00:01.000Z',
  payload,
});

describe('room event application', () => {
  it('applies the next seq and drops duplicates and old events', () => {
    const state = fromSnapshot(snapshot());
    const joined = event('4', 'room.memberJoined', {
      memberId: GUEST,
      username: 'guest',
      displayName: 'Guest',
      seat: 1,
    });
    const first = applyEvent(state, joined);
    expect(first.kind).toBe('applied');
    if (first.kind !== 'applied') return;
    expect(first.state.snapshot.room.members.map((m) => m.id)).toEqual([HOST, GUEST]);
    expect(first.state.cursors[PUBLIC]).toBe('4');
    expect(applyEvent(first.state, joined).kind).toBe('duplicate');
    expect(applyEvent(first.state, event('2', 'presence.changed', {})).kind).toBe('duplicate');
  });

  it('reports a gap instead of guessing past a missing seq', () => {
    const result = applyEvent(
      fromSnapshot(snapshot()),
      event('6', 'presence.changed', { memberId: HOST, status: 'offline' }),
    );
    expect(result).toEqual({ kind: 'gap', streamId: PUBLIC, afterSeq: '3' });
  });

  it('ignores streams the viewer was never granted', () => {
    const other = event('1', 'room.memberJoined', {}, '00000000-0000-4000-8000-00000000dead');
    expect(applyEvent(fromSnapshot(snapshot()), other).kind).toBe('duplicate');
  });

  it('settings changes clear readiness and ask for a fresh snapshot', () => {
    const result = applyEvent(
      fromSnapshot(snapshot()),
      event('4', 'room.settingsChanged', { configVersion: '2', settings: { maxPlayers: 6 } }),
    );
    if (result.kind !== 'applied') throw new Error('expected applied');
    expect(result.refetch).toBe(true);
    expect(result.state.snapshot.room.configVersion).toBe('2');
    expect(result.state.snapshot.room.members.every((m) => !m.ready)).toBe(true);
  });

  it('readiness for an old rules version is not applied', () => {
    const result = applyEvent(
      fromSnapshot(snapshot()),
      event('4', 'room.readinessChanged', { configVersion: '0', memberId: HOST, ready: false }),
    );
    if (result.kind !== 'applied') throw new Error('expected applied');
    expect(result.state.snapshot.room.members[0]!.ready).toBe(true);
  });

  it('control change makes other tabs read-only and this tab the controller', () => {
    const changed = event(
      '1',
      'member.controlChanged',
      { newEpoch: '1', controllerConnectionId: 'sock-b' },
      PRIVATE,
    );
    const tabA = applyEvent(fromSnapshot(snapshot()), changed, 'sock-a');
    const tabB = applyEvent(fromSnapshot(snapshot()), changed, 'sock-b');
    if (tabA.kind !== 'applied' || tabB.kind !== 'applied') throw new Error('expected applied');
    expect(tabA.state.snapshot.me).toMatchObject({ controlEpoch: '1', isController: false });
    expect(tabB.state.snapshot.me).toMatchObject({ controlEpoch: '1', isController: true });
  });
});

describe('even deal hints', () => {
  it('lists the player counts that receive 4–30 cards each', () => {
    expect(evenDealCounts(48, 8)).toEqual([2, 3, 4, 6, 8]);
    expect(evenDealCounts(50, 4)).toEqual([2]);
    expect(evenDealCounts(9, 4)).toEqual([]);
  });
});

describe('delivery order independence (E45)', () => {
  /** Client loop: apply what fits, hold events past a gap until the gap is filled. */
  function deliver(events: RoomEvent[]) {
    let state = fromSnapshot(snapshot());
    let held: RoomEvent[] = [];
    const offer = (e: RoomEvent) => {
      const r = applyEvent(state, e);
      if (r.kind === 'applied') state = r.state;
      if (r.kind === 'gap') held.push(e);
      return r.kind === 'applied';
    };
    for (const e of events) {
      if (!offer(e)) continue;
      let progressed = true;
      while (progressed) {
        progressed = false;
        const pending = held;
        held = [];
        for (const h of pending) if (offer(h)) progressed = true;
      }
    }
    return state;
  }

  it('shuffled and duplicated deliveries converge on the in-order projection', () => {
    const ordered = [
      event('4', 'room.memberJoined', {
        memberId: GUEST,
        username: 'guest',
        displayName: 'Guest',
        seat: 1,
      }),
      event('5', 'room.readinessChanged', { configVersion: '1', memberId: GUEST, ready: true }),
      event('6', 'presence.changed', { memberId: HOST, status: 'offline' }),
      event('7', 'room.readinessChanged', { configVersion: '1', memberId: HOST, ready: false }),
    ];
    const expected = deliver(ordered);
    const shuffles = [
      [ordered[2]!, ordered[0]!, ordered[3]!, ordered[1]!],
      [ordered[3]!, ordered[2]!, ordered[1]!, ordered[0]!],
      [ordered[0]!, ordered[0]!, ordered[1]!, ordered[3]!, ordered[1]!, ordered[2]!, ordered[3]!],
    ];
    for (const s of shuffles) expect(deliver(s)).toEqual(expected);
    expect(expected.cursors[PUBLIC]).toBe('7');
  });
});
