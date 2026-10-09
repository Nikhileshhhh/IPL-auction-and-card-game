import type { Metadata } from 'next';
import { Wordmark } from '@/components/shell/Wordmark';
import { FEATURES, FEATURE_PHASE } from '@/lib/features';

export const metadata: Metadata = { title: 'Access' };

export default function AccessPage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-[var(--gutter)]">
      <section
        aria-labelledby="access-heading"
        className="w-full max-w-[400px] rounded-[var(--radius-panel)] border border-line bg-raised p-8 shadow-[var(--shadow-panel)]"
      >
        <Wordmark size="lg" />
        <h1 id="access-heading" className="mt-6 text-xl font-semibold">
          Private club access
        </h1>
        <p className="mt-2 text-ink-2">
          {FEATURES.accessGate
            ? 'Enter your invitation code.'
            : `Invitation verification opens in phase ${FEATURE_PHASE.accessGate}. No account data is available yet.`}
        </p>
      </section>
    </main>
  );
}
