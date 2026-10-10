'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApiError, RoomLobbyDTO } from '@stumps/contracts';
import { api } from '@/lib/api-client';

/**
 * Submit a create-room request. An identical retry (same body) reuses the
 * Idempotency-Key so a lost response never creates a second room; a changed
 * form gets a new key.
 */
export function useCreateRoom(nextPath: (roomId: string) => string) {
  const router = useRouter();
  const last = useRef<{ key: string; body: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(body: Record<string, unknown>) {
    const serialized = JSON.stringify(body);
    const key = last.current?.body === serialized ? last.current.key : crypto.randomUUID();
    last.current = { key, body: serialized };
    setPending(true);
    setError(null);
    const res = await api<{ lobby: RoomLobbyDTO; roomCode: string }>('/rooms', {
      method: 'POST',
      body,
      idempotencyKey: key,
    });
    if (res.ok) {
      router.push(nextPath(res.data.lobby.roomId));
      return;
    }
    setPending(false);
    setError(res.error);
  }

  return { submit, pending, error };
}

export function describeCreateError(error: ApiError): string {
  const reason = (error.details as { reason?: string } | undefined)?.reason;
  if (reason === 'MEMBERSHIP_LIMIT')
    return 'You are already in two rooms. Leave one from its lobby first.';
  if (error.code === 'RATE_LIMITED')
    return 'You have created several rooms recently. Wait a little and try again.';
  if (error.code === 'VALIDATION_FAILED' || error.code === 'CONFIG_INVALID') {
    return 'Some settings are outside the allowed limits. Check the highlighted values.';
  }
  return error.message;
}
