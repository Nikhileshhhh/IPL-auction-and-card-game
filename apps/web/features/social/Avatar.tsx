import { cx } from '@stumps/ui';

/**
 * A member's avatar (a re-encoded upload served privately) or their initial.
 * Plain <img>: the bytes come from the same-origin media proxy.
 */
export function Avatar({
  name,
  url,
  size = 'md',
}: {
  name: string;
  url: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = { sm: 'size-10 text-base', md: 'size-12 text-lg', lg: 'size-20 text-3xl' }[size];
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private media proxy, already re-encoded
      <img
        src={url}
        alt=""
        className={cx(box, 'shrink-0 rounded-full border border-line object-cover')}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        box,
        'grid shrink-0 place-items-center rounded-full bg-overlay font-bold text-card',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
