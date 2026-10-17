import type { Metadata } from 'next';
import { AnnouncementsAdmin } from '@/components/admin/AnnouncementsAdmin';

export const metadata: Metadata = { title: 'Announcements' };

export default function AdminAnnouncementsPage() {
  return (
    <div>
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Announcements</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Short plain-text notices shown on every member&apos;s dashboard during their window.
      </p>
      <div className="mt-8">
        <AnnouncementsAdmin />
      </div>
    </div>
  );
}
