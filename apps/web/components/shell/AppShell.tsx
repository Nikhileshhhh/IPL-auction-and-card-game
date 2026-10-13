import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SessionProjection } from '@stumps/contracts';
import { ConnectionBoundary } from './ConnectionBoundary';
import { InboxLink } from './InboxLink';
import { SignOutButton } from './SignOutButton';
import { Wordmark } from './Wordmark';

const NAV = [
  { href: '/play', label: 'Play' },
  { href: '/play/cards', label: 'Card Battle' },
  { href: '/play/auction', label: 'Mega Auction' },
] as const;

export function AppShell({
  children,
  session,
}: {
  children: ReactNode;
  session?: SessionProjection;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-raised focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex min-h-16 max-w-[var(--content-max)] flex-wrap items-center justify-between gap-2 px-[var(--gutter)] py-2">
          <Link href="/play" className="rounded-lg text-ink">
            <Wordmark />
          </Link>
          <nav aria-label="Primary">
            <ul className="flex flex-wrap items-center gap-1 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:bg-overlay hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              {session ? (
                <>
                  <li>
                    <Link
                      href="/friends"
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:bg-overlay hover:text-ink"
                    >
                      Friends
                    </Link>
                  </li>
                  <li>
                    <InboxLink />
                  </li>
                  <li>
                    <Link
                      href={`/players/${session.username}`}
                      className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:bg-overlay hover:text-ink"
                      aria-label={`Your profile, signed in as ${session.displayName}`}
                    >
                      <span aria-hidden="true">{session.displayName}</span>
                    </Link>
                  </li>
                  <li>
                    <SignOutButton />
                  </li>
                </>
              ) : null}
            </ul>
          </nav>
        </div>
      </header>
      <ConnectionBoundary>
        <main
          id="main"
          className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-[var(--gutter)] py-8"
        >
          {children}
        </main>
      </ConnectionBoundary>
      <footer className="border-t border-line px-[var(--gutter)] py-4 text-xs text-ink-3">
        STUMPS is an independent fan simulator. Not affiliated with the IPL, BCCI or any franchise.
      </footer>
    </div>
  );
}
