import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AccessGate } from '@/components/auth/AccessGate';
import { AuthLayout } from '@/components/auth/AuthLayout';

export const metadata: Metadata = { title: 'Access' };
export const dynamic = 'force-dynamic';

export default function AccessPage() {
  return (
    <AuthLayout
      title="Private club access"
      intro="This is an invitation-only club. Enter the access code to continue."
    >
      <Suspense
        fallback={<div className="h-48 animate-pulse rounded-xl bg-raised" aria-hidden="true" />}
      >
        <AccessGate />
      </Suspense>
    </AuthLayout>
  );
}
