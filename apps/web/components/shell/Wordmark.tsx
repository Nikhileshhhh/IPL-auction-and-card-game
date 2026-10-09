/** STUMPS wordmark with an original three-stump motif (UI spec §1). */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const height = size === 'lg' ? 40 : 28;
  return (
    <span className="inline-flex items-center gap-2" aria-label="STUMPS">
      <svg width={height * 0.8} height={height} viewBox="0 0 24 30" aria-hidden="true">
        <rect x="2" y="2" width="20" height="3" rx="1.5" fill="var(--accent-card)" />
        <rect x="3" y="7" width="3" height="21" rx="1.5" fill="currentColor" />
        <rect x="10.5" y="7" width="3" height="21" rx="1.5" fill="currentColor" />
        <rect x="18" y="7" width="3" height="21" rx="1.5" fill="currentColor" />
      </svg>
      <span
        className="font-display font-bold tracking-[0.18em] uppercase"
        style={{ fontSize: size === 'lg' ? 32 : 22, lineHeight: 1 }}
      >
        Stumps
      </span>
    </span>
  );
}
