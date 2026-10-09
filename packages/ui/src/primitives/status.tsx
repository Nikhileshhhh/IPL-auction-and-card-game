import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatusTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<StatusTone, { box: string; label: string }> = {
  info: { box: 'border-line bg-raised text-ink', label: 'Note' },
  success: { box: 'border-ok/50 bg-[#0f2a22] text-ink', label: 'Done' },
  warning: { box: 'border-warn/60 bg-[#2d2412] text-ink', label: 'Warning' },
  error: { box: 'border-bad/60 bg-[#2d1219] text-ink', label: 'Problem' },
};

/**
 * Status text never relies on colour alone: a visible tone label plus the
 * message. Errors use role="alert"; others are polite status updates.
 */
export function StatusMessage({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: StatusTone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cx('rounded-[var(--radius-panel-sm)] border px-4 py-3 text-sm', t.box, className)}
    >
      <p className="font-semibold">{title ?? t.label}</p>
      <div className="mt-1 text-ink-2">{children}</div>
    </div>
  );
}
