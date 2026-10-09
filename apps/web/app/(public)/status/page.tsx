import { AppShell } from '@/components/shell/AppShell';

export const metadata = { title: 'Service status' };
export const dynamic = 'force-dynamic';

export default function StatusPage() {
  return (
    <AppShell>
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Service status</h1>
      <p className="mt-4 max-w-2xl text-ink-2">
        Connection and maintenance status appears here (S35). Live health reporting is wired to the
        API readiness endpoint in a later phase; this page does not claim the service is healthy.
      </p>
    </AppShell>
  );
}
