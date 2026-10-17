import type { Metadata } from 'next';
import { DesignReview } from '@/components/admin/DesignReview';

export const metadata: Metadata = { title: 'Design review' };

/** Fixture gallery for visual review (UI spec §8); original art, no game data. */
export default function DesignReviewPage() {
  return (
    <div>
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Design review</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Edge cases the visual review checks at every target size. Fixtures only: these are not real
        players or prices.
      </p>
      <div className="mt-8">
        <DesignReview />
      </div>
    </div>
  );
}
