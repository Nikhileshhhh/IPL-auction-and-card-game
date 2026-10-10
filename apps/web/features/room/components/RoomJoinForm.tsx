'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, PasswordField, StatusMessage, TextField } from '@stumps/ui';
import {
  ROOM_CODE_LENGTH,
  formatRoomCode,
  normalizeRoomCode,
  type ApiError,
  type RoomLobbyDTO,
} from '@stumps/contracts';
import { api } from '@/lib/api-client';

function describe(error: ApiError, gameType: 'card' | 'auction'): string {
  switch (error.code) {
    case 'JOIN_FAILED':
      return 'Could not join. Check the room code and password.';
    case 'GAME_MISMATCH':
      return gameType === 'card'
        ? 'That code is for a Mega Auction room. Join it from Mega Auction.'
        : 'That code is for a Card Battle room. Join it from Card Battle.';
    case 'ROOM_FULL':
      return 'This room is full.';
    case 'GAME_STARTED':
      return 'This game has already started.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute before trying again.';
    default:
      return (error.details as { reason?: string } | undefined)?.reason === 'MEMBERSHIP_LIMIT'
        ? 'You are already in two rooms. Leave one first.'
        : error.message;
  }
}

/** S06/S15: secure join with a generated code (never placed in the URL). */
export function RoomJoinForm({ gameType }: { gameType: 'card' | 'auction' }) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const normalized = normalizeRoomCode(code);
  const complete = normalized.length === ROOM_CODE_LENGTH;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!complete) return;
    setPending(true);
    setError(null);
    const res = await api<RoomLobbyDTO>('/rooms/join', {
      method: 'POST',
      body: { code: normalized, gameType, ...(password ? { password } : {}) },
    });
    if (res.ok) {
      router.push(
        gameType === 'card'
          ? `/rooms/${res.data.roomId}/lobby`
          : `/rooms/${res.data.roomId}/franchises`,
      );
      return;
    }
    setPending(false);
    setError(res.error);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-6">
      <TextField
        label="Room code"
        name="roomCode"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        value={code}
        maxLength={40}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => complete && setCode(formatRoomCode(normalized))}
        hint={`${ROOM_CODE_LENGTH} characters. Spaces and dashes are fine.`}
      />
      <PasswordField
        label="Room password (if the host set one)"
        name="roomPassword"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {gameType === 'auction' ? (
        <p className="text-sm text-ink-2">
          Step 1 of 2: join the room. Step 2: choose a franchise or ask to join one. A room code is
          not a team invitation.
        </p>
      ) : null}
      {error ? <StatusMessage tone="error">{describe(error, gameType)}</StatusMessage> : null}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          variant={gameType === 'card' ? 'primary' : 'auction'}
          pending={pending}
          pendingLabel="Joining…"
          disabled={!complete}
        >
          Join room
        </Button>
        <Link
          href={gameType === 'card' ? '/play/cards' : '/play/auction'}
          className="min-h-11 py-3 text-sm text-ink-2 underline"
        >
          Back
        </Link>
      </div>
    </form>
  );
}
