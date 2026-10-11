'use client';

import { useEffect, useState } from 'react';

/**
 * Server-time "now" for countdowns: the offset is taken when a snapshot
 * arrives (its `serverNow`), so a wrong device clock never moves a deadline.
 * Deadlines are decided by the server; the countdown is only a display.
 */
export function useServerNow(serverNow: string, tickMs = 250): number {
  const [clock, setClock] = useState(() => ({
    offset: new Date(serverNow).getTime() - Date.now(),
    local: Date.now(),
  }));
  useEffect(() => {
    const offset = new Date(serverNow).getTime() - Date.now();
    const id = setInterval(() => setClock({ offset, local: Date.now() }), tickMs);
    return () => clearInterval(id);
  }, [serverNow, tickMs]);
  return clock.local + clock.offset;
}
