import {
  CARD_METRICS,
  METRIC_LABELS,
  ROLE_LABELS,
  type PublicCardDTO,
  type Rarity,
} from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { PortraitImage } from './PortraitImage';
import { teamBackdrop } from './teams';

export const RARITY_NAMES: Record<Rarity, string> = {
  normal: 'Normal',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  dual_platinum: 'Dual Platinum',
};

export type CardSize = 'mini' | 'compact' | 'standard' | 'detail';

const SIZES: Record<
  CardSize,
  { box: string; name: string; num: string; label: string; meta: string; sizes: string }
> = {
  mini: {
    box: 'w-[132px]',
    name: 'text-[11px]',
    num: 'text-sm',
    label: 'text-[8px]',
    meta: 'text-[8px]',
    sizes: '132px',
  },
  compact: {
    box: 'w-[240px]',
    name: 'text-[15px]',
    num: 'text-xl',
    label: 'text-[9px]',
    meta: 'text-[10px]',
    sizes: '240px',
  },
  standard: {
    box: 'w-[300px]',
    name: 'text-lg',
    num: 'text-2xl',
    label: 'text-[10px]',
    meta: 'text-[11px]',
    sizes: '300px',
  },
  detail: {
    box: 'w-[min(460px,100%)]',
    name: 'text-2xl',
    num: 'text-3xl',
    label: 'text-xs',
    meta: 'text-xs',
    sizes: '460px',
  },
};

/** Short labels for the card face (full names stay in the accessible label). */
const SHORT_LABELS: Record<(typeof CARD_METRICS)[number], string> = {
  batting: 'BAT',
  bowling: 'BOWL',
  fielding: 'FIELD',
  form: 'FORM',
  experience: 'EXP',
  versatility: 'VERS',
};

/** Rarities that shine and glow; Bronze and Normal stay matte (product owner). */
export const SHINING: ReadonlySet<Rarity> = new Set([
  'silver',
  'gold',
  'platinum',
  'dual_platinum',
]);

function Stars({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cx('flex items-center', className)}
      role="img"
      aria-label={`${count} of 5 stars`}
    >
      <span
        aria-hidden="true"
        className="tracking-tight text-[#ffd76a] drop-shadow-[0_0_4px_rgba(255,200,80,0.6)]"
      >
        {'★'.repeat(count)}
        <span className="text-white/25">{'★'.repeat(5 - count)}</span>
      </span>
    </span>
  );
}

const SPARKLES = [
  { top: '9%', left: '78%', delay: '0s' },
  { top: '36%', left: '12%', delay: '0.9s' },
  { top: '58%', left: '86%', delay: '1.7s' },
];

/**
 * Card art (UI spec §2): rarity crest and stars, a team-coloured spotlight
 * behind the player photo (both photos side by side on a dual card), the
 * name plate, and six Game ratings (0–100) with bars in a stable 3×2 grid.
 * Rarity changes only the look (R19): Gold, Silver and Platinum shine and
 * glow; Platinum frames are holographic; Bronze and Normal are matte.
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
  const shines = SHINING.has(card.rarity);
  const holo = card.rarity === 'platinum' || card.rarity === 'dual_platinum';
  const mini = size === 'mini';
  return (
    <article
      aria-label={`${RARITY_NAMES[card.rarity]} card: ${names}. ${CARD_METRICS.map(
        (m) => `${METRIC_LABELS[m]} ${card.ratings[m]}`,
      ).join(', ')}.`}
      data-rarity={card.rarity}
      data-shine={shines ? 'true' : 'false'}
      className={cx('stumps-card aspect-[5/7] shrink-0', s.box, className)}
    >
      <div className="stumps-card-inner">
        {/* Portrait with a team-coloured spotlight */}
        <div
          className={cx('relative w-full shrink-0 overflow-hidden', mini ? 'h-[50%]' : 'h-[54%]')}
          style={{ background: teamBackdrop(first.team) }}
        >
          {dual && second ? (
            <>
              <div
                className="absolute inset-0"
                style={{
                  background: teamBackdrop(second.team),
                  clipPath: 'polygon(58% 0,100% 0,100% 100%,42% 100%)',
                }}
              />
              {/* Side by side with a slanted seam so both faces stay visible. */}
              <div className="absolute inset-y-0 left-0 w-[58%] [clip-path:polygon(0_0,100%_0,72.4%_100%,0_100%)]">
                <PortraitImage
                  src={first.portraitUrl}
                  alt={first.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                  className="object-cover object-[center_12%]"
                />
              </div>
              <div className="absolute inset-y-0 right-0 w-[58%] [clip-path:polygon(27.6%_0,100%_0,100%_100%,0_100%)]">
                <PortraitImage
                  src={second.portraitUrl}
                  alt={second.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                  className="object-cover object-[center_12%]"
                />
              </div>
              <svg
                aria-hidden="true"
                className="absolute inset-0 h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <line
                  x1="58"
                  y1="0"
                  x2="42"
                  y2="100"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </>
          ) : (
            <PortraitImage
              src={first.portraitUrl}
              alt={first.portraitAlt}
              sizes={s.sizes}
              priority={priority}
              className="object-cover object-[center_12%]"
            />
          )}
          {holo ? <div aria-hidden="true" className="stumps-card-holo" /> : null}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[var(--panel)] via-[var(--panel)]/60 to-transparent"
          />
          {/* Crest and stars */}
          <div
            className={cx(
              'absolute inset-x-0 top-0 flex items-start justify-between',
              mini ? 'p-1.5' : 'p-2.5',
            )}
          >
            <span
              className={cx(
                'stumps-crest rounded-full font-bold tracking-[0.14em] uppercase backdrop-blur-sm',
                mini ? 'px-1.5 py-0.5 text-[7px]' : 'px-2.5 py-0.5',
                !mini && s.label,
              )}
            >
              {RARITY_NAMES[card.rarity]}
            </span>
            {mini ? null : (
              <Stars
                count={card.stars}
                className={cx('rounded-full bg-black/45 px-2 py-0.5 backdrop-blur-sm', s.label)}
              />
            )}
          </div>
        </div>

        {/* Name plate */}
        <div className={cx('relative shrink-0', mini ? '-mt-4 px-1.5' : '-mt-7 px-3')}>
          <p
            className={cx(
              'font-display leading-[1.05] font-bold tracking-wide text-white uppercase drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]',
              mini && 'truncate',
              s.name,
            )}
          >
            {names}
          </p>
          {mini ? null : (
            <>
              <span
                aria-hidden="true"
                className="stumps-name-rule my-1 block h-[2px] w-10 rounded-full"
              />
              <p className={cx('truncate text-white/70', s.meta)}>
                {roles}
                {teams ? ` · ${teams}` : ''}
              </p>
            </>
          )}
        </div>

        {/* Six game ratings, stable 3×2 grid with bars */}
        <dl
          className={cx(
            'stumps-stats grid flex-1 grid-cols-3 grid-rows-2',
            mini ? 'gap-0.5 p-1' : 'gap-1.5 p-2.5 pt-2',
          )}
        >
          {CARD_METRICS.map((m) => (
            <div
              key={m}
              data-highlight={highlight === m ? 'true' : 'false'}
              className={cx(
                'stumps-stat flex flex-col justify-center rounded-md bg-white/[0.04]',
                mini ? 'px-1 py-0.5' : 'px-2 py-1',
              )}
            >
              <dt className={cx('truncate tracking-wider text-white/70 uppercase', s.label)}>
                {size === 'detail' ? (
                  METRIC_LABELS[m]
                ) : (
                  <abbr title={METRIC_LABELS[m]} className="no-underline">
                    {SHORT_LABELS[m]}
                  </abbr>
                )}
              </dt>
              <dd
                className={cx('font-display leading-none font-bold text-white tabular-nums', s.num)}
              >
                {card.ratings[m]}
              </dd>
              <span
                aria-hidden="true"
                className={cx('mt-1 block h-[3px] rounded-full bg-white/10', mini && 'hidden')}
              >
                <span
                  className="stumps-stat-bar block h-full rounded-full"
                  style={{ width: `${card.ratings[m]}%` }}
                />
              </span>
            </div>
          ))}
        </dl>
      </div>
      {shines ? <div aria-hidden="true" className="stumps-card-shine" /> : null}
      {card.rarity === 'gold' && !mini
        ? SPARKLES.map((p) => (
            <span
              key={p.top}
              aria-hidden="true"
              className="stumps-card-sparkle"
              style={{ top: p.top, left: p.left, animationDelay: p.delay }}
            />
          ))
        : null}
    </article>
  );
}
