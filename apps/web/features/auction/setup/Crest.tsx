import { cx } from '@stumps/ui';

/**
 * Franchise crest: the team colours with its short name as text, always shown
 * next to the full name, so identity never relies on colour alone.
 */
export function Crest({
  shortName,
  primaryHex,
  secondaryHex,
  size = 'md',
}: {
  shortName: string;
  primaryHex: string;
  secondaryHex: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full border-2 font-display font-bold tracking-wide',
        size === 'sm' && 'h-9 w-9 text-[11px]',
        size === 'md' && 'h-12 w-12 text-sm',
        size === 'lg' && 'h-16 w-16 text-base',
      )}
      style={{
        background: `radial-gradient(circle at 30% 30%, ${secondaryHex}55, ${primaryHex} 70%)`,
        borderColor: secondaryHex,
        color: '#fff',
        textShadow: '0 1px 2px rgba(0,0,0,.6)',
      }}
    >
      {shortName}
    </span>
  );
}
