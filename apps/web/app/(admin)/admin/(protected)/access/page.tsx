import type { Metadata } from 'next';
import { AccessRotationPanel } from '@/components/admin/AccessRotationPanel';

export const metadata: Metadata = { title: 'Access' };

export default function AdminAccessPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Access</h1>
      <p className="mt-2 text-ink-2">Rotate the website access code and its lockout policy.</p>
      <div className="mt-8">
        <AccessRotationPanel />
      </div>
    </div>
  );
}
