'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, resetCsrf } from '@/lib/api-client';

export function SignOutButton({ scope = 'member' }: { scope?: 'member' | 'admin' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await api(scope === 'admin' ? '/admin/auth/logout' : '/auth/logout', {
          method: 'POST',
          body: scope === 'admin' ? undefined : { scope: 'current' },
        });
        resetCsrf();
        router.replace(scope === 'admin' ? '/admin/login' : '/auth');
        router.refresh();
      }}
      className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-ink-2 hover:bg-overlay hover:text-ink"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
