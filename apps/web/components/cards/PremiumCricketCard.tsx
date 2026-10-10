import {
  CARD_METRICS,
  METRIC_LABELS,
  ROLE_LABELS,
  type PublicCardDTO,
  type Rarity,
} from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { PortraitImage } from './PortraitImage';

export const RARITY_NAMES: Record<Rarity, string> = {
  normal: 'Normal',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  dual_platinum: 'Dual Platinum',
};

export type CardSize = 'compact' | 'standard' | 'detail';

const SIZES: Record<
  CardSize,
  { box: string; name: string; num: string; label: string; sizes: string }
> = {
  compact: {
    box: 'w-[240px]',
    name: 'text-sm',
    num: 'text-lg',
    label: 'text-[10px]',
    sizes: '240px',
  },
  standard: {
    box: 'w-[320px]',
    name: 'text-base',
    num: 'text-2xl',
    label: 'text-[11px]',
    sizes: '320px',
  },
  detail: {
    box: 'w-[min(520px,100%)]',
    name: 'text-xl',
    num: 'text-3xl',
    label: 'text-xs',
    sizes: '520px',
  },
};

function Stars({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={`${count} of 5 stars`}>
      <span aria-hidden="true" className="tracking-tight text-[#ffd76a]">
        {'★'.repeat(count)}
        <span className="text-white/25">{'★'.repeat(5 - count)}</span>
      </span>
    </span>
  );
}

/**
 * Card art (UI spec §2): portrait in the upper 55 %, names across the lower
 * portrait margin, six Game ratings (0–100) in a stable 2×3 grid, stars and
 * rarity in a dedicated footer. Rarity only changes the frame (R19).
 */
export function PremiumCricketCard({
  card,
  size = 'standard',
  priority = false,
  highlight,
  className,
}: {
  card: PublicCardDTO;
  size?: CardSize;
  priority?: boolean;
  highlight?: (typeof CARD_METRICS)[number];
  className?: string;
}) {
  const s = SIZES[size];
  const dual = card.players.length === 2;
  const [first, second] = card.players;
  if (!first) return null;
  const names = card.players.map((p) => p.name).join(' & ');
  const teams = [...new Set(card.players.map((p) => p.team).filter(Boolean))].join(' / ');
  const roles = [...new Set(card.players.map((p) => ROLE_LABELS[p.role]))].join(' / ');
  return (
    <article
      aria-label={`${RARITY_NAMES[card.rarity]} card: ${names}. ${CARD_METRICS.map(
        (m) => `${METRIC_LABELS[m]} ${card.ratings[m]}`,
      ).join(', ')}.`}
      data-rarity={card.rarity}
      className={cx(
        'stumps-card relative aspect-[5/7] shrink-0 p-[3px] shadow-[var(--shadow-panel)]',
        s.box,
        className,
      )}
    >
      <div className="stumps-card-inner relative flex h-full flex-col overflow-hidden bg-[#0b1626]">
        {/* Portrait: upper 55 % */}
        <div className="relative h-[55%] w-full overflow-hidden bg-[#14263B]">
          {dual && second ? (
            <>
              <div className="absolute inset-0 [clip-path:polygon(0_0,100%_0,0_100%)]">
                <PortraitImage
                  src={first.portraitUrl}
                  alt={first.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                />
              </div>
              <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                <PortraitImage
                  src={second.portraitUrl}
                  alt={second.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                />
              </div>
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[linear-gradient(to_top_left,transparent_calc(50%-1px),var(--rarity-dual)_50%,transparent_calc(50%+1px))]"
              />
            </>
          ) : (
            <PortraitImage
              src={first.portraitUrl}
              alt={first.portraitAlt}
              sizes={s.sizes}
              priority={priority}
            />
          )}
          <div
            aria-hidden="true"
            className="stumps-card-foil pointer-events-none absolute inset-0"
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b1626] via-[#0b1626]/85 to-transparent px-3 pt-8 pb-2">
            <p className={cx('font-display leading-tight font-semibold text-white', s.name)}>
              {names}
            </p>
            <p className={cx('truncate text-white/75', s.label)}>
              {roles}
              {teams ? ` · ${teams}` : ''}
            </p>
          </div>
        </div>

        {/* Six game ratings, stable 2×3 grid */}
        <dl className="grid flex-1 grid-cols-3 grid-rows-2 gap-px bg-white/10">
          {CARD_METRICS.map((m) => (
            <div
              key={m}
              className={cx(
                'flex flex-col items-center justify-center bg-[#0b1626] px-1',
                highlight === m &&
                  'bg-[#123a33] outline outline-2 -outline-offset-2 outline-[var(--accent-card)]',
              )}
            >
              <dt className={cx('tracking-wide text-white/70 uppercase', s.label)}>
                {METRIC_LABELS[m]}
              </dt>
              <dd
                className={cx('font-display leading-none font-bold text-white tabular-nums', s.num)}
              >
                {card.ratings[m]}
              </dd>
            </div>
          ))}
        </dl>

        {/* Footer: rarity + stars */}
        <div
          className={cx(
            'flex items-center justify-between bg-black/40 px-3 py-1.5 text-white',
            s.label,
          )}
        >
          <span
            className="font-semibold tracking-wider uppercase"
            style={{ color: 'var(--frame)' }}
          >
            {RARITY_NAMES[card.rarity]}
          </span>
          <Stars count={card.stars} />
        </div>
      </div>
    </article>
  );
}
