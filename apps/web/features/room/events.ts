import type { PermittedSnapshotDTO, RoomLobbyDTO, RoomMemberSummary } from '@stumps/contracts';

export interface RoomEvent {
  eventId: string;
  type: string;
  streamId: string;
  seq: string;
  roomStateVersion: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface RoomState {
  snapshot: PermittedSnapshotDTO;
  /** Last applied seq per permitted stream (decimal strings compared as bigint). */
  cursors: Record<string, string>;
}

export type ApplyResult =
  | { kind: 'duplicate' }
  | { kind: 'gap'; streamId: string; afterSeq: string }
  | { kind: 'applied'; state: RoomState; refetch: boolean };

export function fromSnapshot(snapshot: PermittedSnapshotDTO): RoomState {
  return {
    snapshot,
    cursors: Object.fromEntries(snapshot.cursors.map((c) => [c.streamId, c.seq])),
  };
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function withMembers(lobby: RoomLobbyDTO, members: RoomMemberSummary[]): RoomLobbyDTO {
  return { ...lobby, members };
}

/**
 * Apply one pushed event to the confirmed state. Events are at-least-once:
 * an old or repeated seq is dropped; a skipped seq means we missed something
 * and must replay/snapshot rather than guess (DB/realtime §3.1). Changes whose
 * derived fields only the server knows (rule labels, capabilities) request a
 * fresh snapshot instead of being reconstructed in the browser.
 */
export function applyEvent(state: RoomState, event: RoomEvent, mySocketId?: string): ApplyResult {
  const current = state.cursors[event.streamId];
  if (current === undefined) return { kind: 'duplicate' };
  const seq = BigInt(event.seq);
  const last = BigInt(current);
  if (seq <= last) return { kind: 'duplicate' };
  if (seq !== last + 1n) return { kind: 'gap', streamId: event.streamId, afterSeq: current };

  const cursors = { ...state.cursors, [event.streamId]: event.seq };
  const snap = state.snapshot;
  const lobby = snap.room;
  let next: RoomLobbyDTO = lobby;
  let refetch = false;
  const p = event.payload;

  switch (event.type) {
    case 'room.memberJoined': {
      const id = str(p.memberId);
      if (!lobby.members.some((m) => m.id === id)) {
        next = withMembers(lobby, [
          ...lobby.members,
          {
            id,
            username: str(p.username),
            displayName: str(p.displayName),
            connectionStatus: p.connectionStatus === 'online' ? 'online' : 'offline',
            seat: typeof p.seat === 'number' ? p.seat : null,
            ready: false,
            role: 'player',
            isHost: false,
          },
        ]);
      }
      break;
    }
    case 'room.memberLeft':
    case 'room.memberRemoved':
      next = withMembers(
        lobby,
        lobby.members.filter((m) => m.id !== str(p.memberId)),
      );
      break;
    case 'room.readinessChanged':
      if (str(p.configVersion) === lobby.configVersion) {
        next = withMembers(
          lobby,
          lobby.members.map((m) =>
            m.id === str(p.memberId) ? { ...m, ready: p.ready === true } : m,
          ),
        );
      }
      break;
    case 'presence.changed':
      next = withMembers(
        lobby,
        lobby.members.map((m) =>
          m.id === str(p.memberId)
            ? { ...m, connectionStatus: p.status === 'online' ? 'online' : 'offline' }
            : m,
        ),
      );
      break;
    case 'room.hostTransferred': {
      const hostId = str(p.hostId);
      next = {
        ...withMembers(
          lobby,
          lobby.members.map((m) => ({ ...m, isHost: m.id === hostId })),
        ),
        hostMemberId: hostId,
      };
      refetch = true; // capabilities change
      break;
    }
    case 'room.settingsChanged':
      next = {
        ...withMembers(
          lobby,
          lobby.members.map((m) => ({ ...m, ready: false })),
        ),
        configVersion: str(p.configVersion),
        settings: (p.settings as Record<string, unknown>) ?? lobby.settings,
      };
      refetch = true; // rule labels are server-derived
      break;
    case 'member.controlChanged':
      return {
        kind: 'applied',
        refetch: false,
        state: {
          cursors,
          snapshot: {
            ...snap,
            me: {
              ...snap.me,
              controlEpoch: str(p.newEpoch),
              isController:
                mySocketId !== undefined && str(p.controllerConnectionId) === mySocketId,
            },
          },
        },
      };
    case 'room.hostHandoverProposed':
      return {
        kind: 'applied',
        refetch: false,
        state: {
          cursors,
          snapshot: {
            ...snap,
            pendingHostHandover: {
              handoverId: str(p.handoverId),
              fromMemberId: str(p.fromMemberId),
              expiresAt: str(p.expiresAt),
            },
          },
        },
      };
    case 'chat.message':
    case 'chat.removed':
    case 'chat.muted':
      // Chat views keep their own list (RoomConnection.listen); the snapshot is unchanged.
      return {
        kind: 'applied',
        refetch: false,
        state: { cursors, snapshot: snap },
      };
    default:
      // Unknown or game events: keep the cursor and let the snapshot catch up.
      refetch = true;
  }
  return {
    kind: 'applied',
    refetch,
    state: {
      cursors,
      snapshot: { ...snap, room: { ...next, stateVersion: event.roomStateVersion } },
    },
  };
}
