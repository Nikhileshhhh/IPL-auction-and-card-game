import { cx } from './cx';

export type Medal = 'gold' | 'silver' | 'bronze';

const MEDAL = {
  gold: { label: 'Gold', ring: '#EBC875', fill: '#4a3a12' },
  silver: { label: 'Silver', ring: '#D6E1ED', fill: '#2c3646' },
  bronze: { label: 'Bronze', ring: '#CF9466', fill: '#3f2717' },
} as const;

/** Medal with its text label always visible: never colour-only (UI spec S29). */
export function MedalBadge({
  medal,
  count,
  size = 'md',
  className,
}: {
  medal: Medal;
  count?: number;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const m = MEDAL[medal];
  const px = size === 'sm' ? 28 : 40;
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <svg width={px} height={px} viewBox="0 0 40 40" aria-hidden="true">
        <path d="M12 2h6l3 9h-6zM28 2h-6l-3 9h6z" fill={m.ring} opacity="0.7" />
        <circle cx="20" cy="25" r="13" fill={m.fill} stroke={m.ring} strokeWidth="3" />
        <path d="M15.5 25h9M20 20.5v9" stroke={m.ring} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-sm">
        <span className="font-semibold">{m.label}</span>
        {count !== undefined ? (
          <span className="ml-1 tabular-nums text-ink-2">× {count}</span>
        ) : null}
      </span>
    </span>
  );
}
