import type { Metadata } from 'next';
import { OperationsOverview } from '@/components/admin/OperationsOverview';

export const metadata: Metadata = { title: 'Administration' };

/** S33 administrator dashboard: measured health, rooms and recent actions. */
export default function AdminHomePage() {
  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Operations</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Measured at request time. Room names, members, chat, cards and results are never shown here.
      </p>
      <div className="mt-8">
        <OperationsOverview />
      </div>
    </div>
  );
}
