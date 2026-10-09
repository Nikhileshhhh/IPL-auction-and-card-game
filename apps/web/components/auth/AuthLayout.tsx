import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/shell/Wordmark';

/** Original stadium silhouette (no third-party artwork). Decorative only. */
function StadiumArt() {
  return (
    <svg
      viewBox="0 0 600 400"
      className="h-full w-full"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="pitchGlow" cx="50%" cy="70%" r="60%">
          <stop offset="0%" stopColor="#1b4d3e" />
          <stop offset="100%" stopColor="#07111F" />
        </radialGradient>
      </defs>
      <rect width="600" height="400" fill="url(#pitchGlow)" />
      <ellipse cx="300" cy="300" rx="260" ry="80" fill="none" stroke="#334B66" strokeWidth="2" />
      <ellipse cx="300" cy="300" rx="180" ry="52" fill="none" stroke="#334B66" strokeWidth="1.5" />
      <rect x="290" y="250" width="20" height="100" rx="3" fill="#2b5e4a" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <g key={i} transform={`translate(${60 + i * 96} 40)`}>
          <rect x="0" y="40" width="6" height="120" fill="#172941" />
          <rect x="-18" y="20" width="42" height="24" rx="4" fill="#F4F7FB" opacity="0.12" />
        </g>
      ))}
      <g transform="translate(276 300)" fill="#F4F7FB" opacity="0.8">
        <rect x="0" y="-36" width="5" height="36" rx="2" />
        <rect x="10" y="-36" width="5" height="36" rx="2" />
        <rect x="20" y="-36" width="5" height="36" rx="2" />
        <rect x="-1" y="-40" width="27" height="3" rx="1.5" fill="#44E0B1" />
      </g>
    </svg>
  );
}

export function AuthLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main" className="grid min-h-dvh lg:grid-cols-[3fr_2fr]">
      <div className="relative hidden overflow-hidden border-r border-line lg:block">
        <StadiumArt />
        <div className="absolute bottom-10 left-10 max-w-md">
          <p className="font-display text-[56px] leading-[60px] font-bold uppercase">
            A private cricket club
          </p>
          <p className="mt-3 text-ink-2">
            Card battles and a mega auction for you and your friends.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-center px-[var(--gutter)] py-10">
        <section aria-labelledby="auth-heading" className="w-full max-w-[400px]">
          <Wordmark size="lg" />
          <h1 id="auth-heading" className="mt-8 text-[28px] leading-[34px] font-semibold">
            {title}
          </h1>
          {intro ? <div className="mt-2 text-ink-2">{intro}</div> : null}
          <div className="mt-8">{children}</div>
          <p className="mt-10 text-xs text-ink-3">
            <Link href="/admin/login" className="underline-offset-2 hover:underline">
              Administrator sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
