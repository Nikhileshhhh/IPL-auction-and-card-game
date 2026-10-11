import {
  CARD_METRICS,
  METRIC_LABELS,
  type CardMetric,
  type PlayerRole,
  type PublicCardDTO,
  type Rarity,
} from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { PortraitImage } from './PortraitImage';
import { teamBurst, teamColours } from './teams';

export const RARITY_NAMES: Record<Rarity, string> = {
  normal: 'Normal',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  dual_platinum: 'Dual Platinum',
};

/** Card role ribbon, Attax style. */
const ROLE_RIBBON: Record<PlayerRole, string> = {
  batter: 'Batsman',
  bowler: 'Bowler',
  all_rounder: 'All-rounder',
  wicketkeeper: 'Wicket-keeper',
};

export type CardSize = 'mini' | 'compact' | 'standard' | 'detail';

const SIZES: Record<
  CardSize,
  {
    box: string;
    ribbon: string;
    circle: string;
    runs: string;
    num: string;
    runsNum: string;
    label: string;
    team: string;
    sizes: string;
  }
> = {
  mini: {
    box: 'w-[132px]',
    ribbon: 'text-[8px]',
    circle: 'h-8 w-8',
    runs: 'h-6 w-6',
    num: 'text-sm',
    runsNum: 'text-[11px]',
    label: 'text-[6px]',
    team: 'text-[6px]',
    sizes: '132px',
  },
  compact: {
    box: 'w-[240px]',
    ribbon: 'text-xs',
    circle: 'h-14 w-14',
    runs: 'h-10 w-10',
    num: 'text-2xl',
    runsNum: 'text-base',
    label: 'text-[9px]',
    team: 'text-[9px]',
    sizes: '240px',
  },
  standard: {
    box: 'w-[300px]',
    ribbon: 'text-sm',
    circle: 'h-[68px] w-[68px]',
    runs: 'h-12 w-12',
    num: 'text-3xl',
    runsNum: 'text-lg',
    label: 'text-[10px]',
    team: 'text-[10px]',
    sizes: '300px',
  },
  detail: {
    box: 'w-[min(420px,100%)]',
    ribbon: 'text-base',
    circle: 'h-24 w-24',
    runs: 'h-16 w-16',
    num: 'text-5xl',
    runsNum: 'text-2xl',
    label: 'text-xs',
    team: 'text-xs',
    sizes: '420px',
  },
};

/** Rarities that shine and glow; Bronze and Normal stay matte (product owner). */
export const SHINING: ReadonlySet<Rarity> = new Set([
  'silver',
  'gold',
  'platinum',
  'dual_platinum',
]);

const SPARKLES = [
  { top: '9%', left: '74%', delay: '0s' },
  { top: '34%', left: '16%', delay: '0.9s' },
  { top: '52%', left: '80%', delay: '1.7s' },
];

/** Bowling left (blue), Runs centre (maroon, with stars), Batting right (green). */
const STAT_STYLE: Record<CardMetric, string> = {
  bowling: 'stumps-stat-bowling',
  runs: 'stumps-stat-runs',
  batting: 'stumps-stat-batting',
};
const STAT_ORDER: readonly CardMetric[] = ['bowling', 'runs', 'batting'];

function Stars({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cx('flex justify-center', className)}
      role="img"
      aria-label={`${count} of 5 stars`}
    >
      <span
        aria-hidden="true"
        className="tracking-tight text-[#ffd76a] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
      >
        {'★'.repeat(count)}
        <span className="text-white/30">{'★'.repeat(5 - count)}</span>
      </span>
    </span>
  );
}

/**
 * Attax-style card art (product owner's sample, original artwork): the player
 * photo on a team-coloured sunburst, the name up the left edge and the role
 * down the right, and the three stats along the bottom — Bowling, Runs (with
 * the star rating) and Batting. Rarity changes only the frame and effects
 * (R19): Gold, Silver and Platinum shine and glow, Platinum frames are
 * holographic, Bronze and Normal are matte.
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
  highlight?: CardMetric;
  className?: string;
}) {
  const s = SIZES[size];
  const dual = card.players.length === 2;
  const [first, second] = card.players;
  if (!first) return null;
  const names = card.players.map((p) => p.name).join(' & ');
  const teams = [...new Set(card.players.map((p) => p.team).filter(Boolean))].join(' / ');
  const roles = [...new Set(card.players.map((p) => ROLE_RIBBON[p.role]))].join(' / ');
  const shines = SHINING.has(card.rarity);
  const holo = card.rarity === 'platinum' || card.rarity === 'dual_platinum';
  const mini = size === 'mini';
  const [teamA, teamB] = teamColours(first.team);
  return (
    <article
      aria-label={`${RARITY_NAMES[card.rarity]} card: ${names}. ${CARD_METRICS.map(
        (m) => `${METRIC_LABELS[m]} ${card.ratings[m]}`,
      ).join(', ')}. ${card.stars} of 5 stars.`}
      data-rarity={card.rarity}
      data-shine={shines ? 'true' : 'false'}
      className={cx('stumps-card aspect-[5/7] shrink-0', s.box, className)}
    >
      <div className="stumps-card-inner" style={{ background: teamBurst(first.team) }}>
        {/* Photo between the ribbons */}
        <div className="absolute inset-x-[11%] top-[5%] bottom-[25%] overflow-hidden">
          {dual && second ? (
            <>
              <div className="absolute inset-y-0 left-0 w-[58%] [clip-path:polygon(0_0,100%_0,72.4%_100%,0_100%)]">
                <PortraitImage
                  src={first.portraitUrl}
                  alt={first.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                  className="object-cover object-top"
                />
              </div>
              <div className="absolute inset-y-0 right-0 w-[58%] [clip-path:polygon(27.6%_0,100%_0,100%_100%,0_100%)]">
                <PortraitImage
                  src={second.portraitUrl}
                  alt={second.portraitAlt}
                  sizes={s.sizes}
                  priority={priority}
                  className="object-cover object-top"
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
              className="object-cover object-top"
            />
          )}
          {holo ? <div aria-hidden="true" className="stumps-card-holo" /> : null}
        </div>

        {/* Name ribbon (left, reading upward) and role ribbon (right) */}
        <div
          className="stumps-ribbon absolute top-[5%] bottom-[25%] left-0 flex w-[11%] items-center justify-center overflow-hidden"
          style={{ background: `linear-gradient(180deg, ${teamA}, ${teamB})` }}
        >
          <p
            className={cx(
              'rotate-180 font-display leading-none font-bold tracking-wide whitespace-nowrap text-white uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] [writing-mode:vertical-rl]',
              s.ribbon,
            )}
          >
            {names}
          </p>
        </div>
        <div className="stumps-ribbon stumps-ribbon-role absolute top-[5%] right-0 bottom-[25%] flex w-[11%] items-center justify-center overflow-hidden">
          <p
            className={cx(
              'font-display leading-none font-bold tracking-wider whitespace-nowrap text-white uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] [writing-mode:vertical-rl]',
              s.ribbon,
            )}
          >
            {roles}
          </p>
        </div>

        {/* Team and rarity */}
        <div className="absolute inset-x-[12%] top-[6%] flex items-start justify-between gap-1">
          {mini ? (
            <span />
          ) : (
            <span
              className={cx(
                'max-w-[60%] truncate rounded-full bg-black/55 px-2 py-0.5 font-semibold tracking-wide text-white uppercase backdrop-blur-sm',
                s.team,
              )}
            >
              {teams}
            </span>
          )}
          <span
            className={cx(
              'stumps-crest rounded-full font-bold tracking-[0.12em] uppercase backdrop-blur-sm',
              mini ? 'px-1 py-0 text-[6px]' : 'px-2 py-0.5',
              !mini && s.team,
            )}
          >
            {RARITY_NAMES[card.rarity]}
          </span>
        </div>

        {/* Stats: Bowling, Runs + stars, Batting */}
        <dl className="stumps-stat-panel absolute inset-x-0 bottom-0 grid h-[27%] grid-cols-3 items-center px-[4%]">
          {STAT_ORDER.map((m) => {
            const isRuns = m === 'runs';
            return (
              <div
                key={m}
                data-highlight={highlight === m ? 'true' : 'false'}
                className="stumps-stat flex flex-col items-center justify-center gap-0.5"
              >
                <dt
                  className={cx(
                    'order-2 font-display font-bold tracking-widest text-white uppercase',
                    s.label,
                  )}
                >
                  {METRIC_LABELS[m]}
                </dt>
                <dd
                  className={cx(
                    'order-1 grid place-items-center rounded-full border-2 border-white/90 font-display leading-none font-bold text-white tabular-nums shadow-[0_3px_10px_rgba(0,0,0,0.6)]',
                    STAT_STYLE[m],
                    isRuns ? cx(s.runs, s.runsNum) : cx(s.circle, s.num),
                  )}
                >
                  {card.ratings[m]}
                </dd>
                {isRuns && !mini ? (
                  <Stars count={card.stars} className={cx('order-3', s.label)} />
                ) : null}
              </div>
            );
          })}
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
