import Link from 'next/link';
import { ReadinessSchema, type Readiness } from '@stumps/contracts';
import { StatusMessage, Surface } from '@stumps/ui';
import { AppShell } from '@/components/shell/AppShell';
import { webServerEnv } from '@/lib/env.server';

export const metadata = { title: 'Service status' };
export const dynamic = 'force-dynamic';

const CHECK_TEXT: Record<string, string> = {
  database: 'Game database',
  schema: 'Database version',
};

type Probe =
  | { kind: 'ready' | 'not_ready'; checks: Readiness['checks']; checkedAt: Date }
  | { kind: 'unreachable'; checkedAt: Date };

/** One server-side probe of the API readiness endpoint, with a short timeout. */
async function probe(): Promise<Probe> {
  const checkedAt = new Date();
  try {
    const res = await fetch(`${webServerEnv().INTERNAL_API_URL.replace(/\/$/, '')}/health/ready`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    const parsed = ReadinessSchema.safeParse(await res.json());
    if (!parsed.success) return { kind: 'unreachable', checkedAt };
    return { kind: parsed.data.status, checks: parsed.data.checks, checkedAt };
  } catch {
    return { kind: 'unreachable', checkedAt };
  }
}

/**
 * S35 service status. It reports what one readiness probe measured just now,
 * with the time it ran; it never claims more than that (no uptime, no fake
 * live counts) and never shows internal details. A game in progress is never
 * lost while the service is unavailable: rooms pause and resume.
 */
export default async function StatusPage() {
  const result = await probe();
  const when = result.checkedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  return (
    <AppShell>
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Service status</h1>
      <p className="mt-2 text-ink-2">
        Checked <time dateTime={result.checkedAt.toISOString()}>{when}</time>. Reload to check
        again.
      </p>
      <div className="mt-6 max-w-2xl">
        {result.kind === 'ready' ? (
          <StatusMessage tone="success" title="Ready">
            The game service answered and its checks passed.
          </StatusMessage>
        ) : result.kind === 'not_ready' ? (
          <StatusMessage tone="warning" title="Degraded">
            The game service answered but is not ready. Running games pause and resume where they
            stopped; nothing is lost.
          </StatusMessage>
        ) : (
          <StatusMessage tone="error" title="Unreachable">
            The game service did not answer. Running games pause and resume where they stopped once
            it is back.
          </StatusMessage>
        )}
      </div>
      {result.kind !== 'unreachable' ? (
        <Surface aria-labelledby="checks-heading" className="mt-6 max-w-2xl">
          <h2 id="checks-heading" className="text-lg font-semibold">
            Checks
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {result.checks.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-3">
                <span>{CHECK_TEXT[c.name] ?? c.name}</span>
                <span className={c.ok ? 'text-ok' : 'text-bad'}>{c.ok ? 'OK' : 'Problem'}</span>
              </li>
            ))}
          </ul>
        </Surface>
      ) : null}
      <p className="mt-6 text-sm">
        <Link href="/status" className="underline">
          Check again
        </Link>{' '}
        ·{' '}
        <Link href="/play" className="underline">
          Back to play
        </Link>
      </p>
    </AppShell>
  );
}
