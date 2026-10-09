import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@stumps/ui';

/**
 * S04 feature tile. The whole tile is one semantic link; hover lifts ≤4px and
 * keyboard focus gets the same emphasis; no looping ambient animation.
 */
export function GameSelectionCard({
  href,
  title,
  tagline,
  accent,
  art,
  facts,
  status,
}: {
  href: string;
  title: string;
  tagline: string;
  accent: 'card' | 'auction';
  art: ReactNode;
  facts: string[];
  status?: string;
}) {
  return (
    <Link
      href={href}
      className={`group block overflow-hidden rounded-[var(--radius-tile)] border border-line bg-raised shadow-[var(--shadow-panel)] transition-transform duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-hover)] focus-visible:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        accent === 'card' ? 'hover:border-card/60' : 'hover:border-auction/60'
      }`}
    >
      <div className="aspect-[16/9] w-full">{art}</div>
      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-[28px] leading-[34px] font-semibold">{title}</h2>
          {status ? <Badge tone="warning">{status}</Badge> : null}
        </div>
        <p className="mt-2 text-ink-2">{tagline}</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {facts.map((fact) => (
            <li key={fact}>
              <Badge tone={accent}>{fact}</Badge>
            </li>
          ))}
        </ul>
        <span
          className={`mt-6 inline-flex min-h-12 items-center rounded-[var(--radius-control)] px-5 font-semibold text-midnight ${
            accent === 'card' ? 'bg-card' : 'bg-auction'
          }`}
        >
          {accent === 'card' ? 'Play Card Battle' : 'Enter Auction'}
        </span>
      </div>
    </Link>
  );
}
