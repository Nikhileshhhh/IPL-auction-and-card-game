import type { Metadata } from 'next';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { RecoveryReset } from '@/components/auth/RecoveryReset';

export const metadata: Metadata = { title: 'Reset password', referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token_hash === 'string' && params.token_hash.length <= 256
      ? params.token_hash
      : null;
  return (
    <AuthLayout title="Choose a new password">
      <RecoveryReset tokenHash={token} />
    </AuthLayout>
  );
}
