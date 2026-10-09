import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';
import { AuthLayout } from '@/components/auth/AuthLayout';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function AuthPage() {
  return (
    <AuthLayout
      title="Welcome to the club"
      intro="Sign in, or request an invitation link for your email."
    >
      <Suspense
        fallback={<div className="h-64 animate-pulse rounded-xl bg-raised" aria-hidden="true" />}
      >
        <AuthForm />
      </Suspense>
    </AuthLayout>
  );
}
