'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NotificationsView } from '@stumps/contracts';
import { api } from '@/lib/api-client';

/** Inbox nav link with the unread count (refreshed on navigation; text, not colour alone). */
export function InboxLink() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void api<NotificationsView>('/notifications').then((res) => {
      if (live && res.ok) setCount(res.data.unread + res.data.invites.filter((i) => i.open).length);
    });
    return () => {
      live = false;
    };
  }, [pathname]);
  return (
    <Link
      href="/notifications"
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-ink-2 hover:bg-overlay hover:text-ink"
    >
      Inbox
      {count > 0 ? (
        <span className="rounded-full bg-card px-2 text-xs font-bold text-midnight tabular-nums">
          {count}
          <span className="sr-only"> new</span>
        </span>
      ) : null}
    </Link>
  );
}
