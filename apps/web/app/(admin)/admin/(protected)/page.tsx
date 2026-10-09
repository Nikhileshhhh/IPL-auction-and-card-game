import type { Metadata } from 'next';
import { AccessRotationPanel } from '@/components/admin/AccessRotationPanel';

export const metadata: Metadata = { title: 'Administration' };

export default function AdminHomePage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Administration</h1>
      <p className="mt-2 text-ink-2">
        Operational dashboards arrive in later phases. Access management is available now.
      </p>
      <div className="mt-8">
        <AccessRotationPanel />
      </div>
    </div>
  );
}
