import type { ReactNode } from 'react';
import { FEATURE_PHASE, type FeatureName } from '@/lib/features';

/**
 * Honest placeholder for a feature-flagged area. It never pretends the flow works.
 */
export function PlaceholderPanel({
  title,
  feature,
  children,
}: {
  title: string;
  feature: FeatureName;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="placeholder-heading"
      className="max-w-2xl rounded-[var(--radius-panel)] border border-line bg-raised p-8 shadow-[var(--shadow-panel)]"
    >
      <h1
        id="placeholder-heading"
        className="font-display text-[40px] leading-[46px] font-semibold"
      >
        {title}
      </h1>
      <p className="mt-4 text-ink-2">
        This area is not available yet. It is switched off until implementation phase{' '}
        {FEATURE_PHASE[feature]} delivers it with server-side checks.
      </p>
      {children}
    </section>
  );
}
