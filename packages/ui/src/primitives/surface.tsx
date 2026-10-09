import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

/** Opaque raised panel (no translucent statistics surfaces, UI spec §2). */
export function Surface({
  as: Tag = 'section',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'div' | 'article' | 'aside';
  children: ReactNode;
}) {
  return (
    <Tag
      className={cx(
        'rounded-[var(--radius-panel)] border border-line bg-raised p-6 shadow-[var(--shadow-panel)]',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Layout-preserving loading placeholder; hidden from assistive technology. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-[var(--radius-panel-sm)] bg-overlay', className)}
    />
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'card' | 'auction' | 'warning';
}) {
  const tones = {
    neutral: 'border-line text-ink-2',
    card: 'border-card/60 text-card',
    auction: 'border-auction/60 text-auction',
    warning: 'border-warn/60 text-warn',
  } as const;
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
