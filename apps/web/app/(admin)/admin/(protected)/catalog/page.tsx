import type { Metadata } from 'next';
import { CatalogAdmin } from '@/components/admin/CatalogAdmin';

export const metadata: Metadata = { title: 'Player catalog' };

/** S34 — data editor: imports, photo coverage, corrections, publish/archive. */
export default function CatalogAdminPage() {
  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Player catalog</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Import real IPL statistics, attach player photos you are allowed to use, review the cards
        and publish an immutable version for new rooms.
      </p>
      <div className="mt-8">
        <CatalogAdmin />
      </div>
    </div>
  );
}
