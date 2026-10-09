import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { InviteCallback } from '@/components/auth/InviteCallback';

export const metadata: Metadata = { title: 'Finish sign-up', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

function first(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length <= 256 ? value : null;
}

export default async function CallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <AuthLayout title="Finish creating your account">
      <InviteCallback tokenHash={first(params.token_hash)} enrollment={first(params.enrollment)} />
    </AuthLayout>
  );
}
