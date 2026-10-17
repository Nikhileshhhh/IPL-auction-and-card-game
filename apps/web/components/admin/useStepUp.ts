'use client';

import { useState } from 'react';
import type { ApiError } from '@stumps/contracts';
import { api } from '@/lib/api-client';

/**
 * Step-up for sensitive admin actions: on STEP_UP_REQUIRED, find the
 * verified authenticator so the caller can show `TotpPrompt` and retry.
 */
export function useStepUp() {
  const [factorId, setFactorId] = useState<string | null>(null);
  async function handle(error: ApiError): Promise<string | null> {
    if (error.code !== 'STEP_UP_REQUIRED') return error.message;
    const factors = await api<{ factorIds: string[] }>('/admin/auth/mfa/factors', {
      method: 'POST',
    });
    if (factors.ok && factors.data.factorIds[0]) {
      setFactorId(factors.data.factorIds[0]);
      return null;
    }
    return 'No authenticator found for step-up verification.';
  }
  return { factorId, clear: () => setFactorId(null), handle };
}
