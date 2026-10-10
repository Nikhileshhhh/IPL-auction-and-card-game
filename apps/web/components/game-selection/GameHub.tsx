import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusMessage, Surface } from '@stumps/ui';

/** Create/join hub for one game. Actions stay disabled (with a reason) while rooms are off. */
export function GameHub({
  title,
  accent,
  intro,
  art,
  enabled,
  createHref,
  joinHref,
  rules,
}: {
  title: string;
  accent: 'card' | 'auction';
  intro: string;
  art: ReactNode;
  enabled: boolean;
  createHref: string;
  joinHref: string;
  rules: string[];
}) {
  const action = `inline-flex min-h-12 items-center justify-center rounded-[var(--radius-control)] px-5 font-semibold`;
  return (
    <div className="flex flex-col gap-8">
      <div className="overflow-hidden rounded-[var(--radius-tile)] border border-line">
        <div className="aspect-[16/5] w-full">{art}</div>
      </div>
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-ink-2">{intro}</p>
      </header>
      <div className="flex flex-wrap gap-3">
        {enabled ? (
          <>
            <Link
              href={createHref}
              className={`${action} text-midnight ${accent === 'card' ? 'bg-card' : 'bg-auction'}`}
            >
              Create a room
            </Link>
            <Link href={joinHref} className={`${action} border border-control bg-raised`}>
              Join with a code
            </Link>
          </>
        ) : (
          <StatusMessage tone="info" title="Rooms are not open yet">
            Creating and joining rooms becomes available when the room service ships. Nothing here
            is simulated.
          </StatusMessage>
        )}
      </div>
      <Surface aria-labelledby="rules-heading">
        <h2 id="rules-heading" className="text-xl font-semibold">
          How it works
        </h2>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-ink-2">
          {rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </Surface>
    </div>
  );
}
