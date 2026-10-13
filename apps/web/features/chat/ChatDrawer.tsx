'use client';

import { useEffect, useState } from 'react';
import { Button } from '@stumps/ui';
import type { LinkStatus, RoomConnection } from '@/features/room/connection';
import { ChatPanel } from './ChatPanel';

/**
 * Chat beside the game (S24/S25): a right-hand drawer on desktop and a
 * full-height sheet on phones. The game stays visible behind it on desktop.
 */
export function ChatDrawer({
  roomId,
  connection,
  status,
  hasTeams,
}: {
  roomId: string;
  connection: RoomConnection;
  status: LinkStatus;
  hasTeams: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <Button
        size="touch"
        variant="secondary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide chat' : 'Chat'}
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-label="Room chat"
          className="fixed inset-0 z-40 flex flex-col border-line shadow-[var(--shadow-panel)] sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] sm:border-l"
        >
          <ChatPanel
            roomId={roomId}
            connection={connection}
            status={status}
            hasTeams={hasTeams}
            onClose={() => setOpen(false)}
          />
        </div>
      ) : null}
    </>
  );
}
