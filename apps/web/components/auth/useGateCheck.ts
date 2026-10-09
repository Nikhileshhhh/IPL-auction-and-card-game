'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AttemptStatus } from '@stumps/contracts';
import { api } from '@/lib/api-client';

/** Redirect to the access gate unless this browser holds a valid grant. */
export function useGateCheck(returnTo: string) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void api<AttemptStatus>('/access/status').then((res) => {
      if (cancelled) return;
      if (res.ok && (res.data.gateStatus === 'preauth' || res.data.gateStatus === 'bound'))
        setReady(true);
      else router.replace(`/access?next=${encodeURIComponent(returnTo)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [returnTo, router]);
  return ready;
}
