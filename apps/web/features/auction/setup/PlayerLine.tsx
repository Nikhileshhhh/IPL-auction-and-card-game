import type { AuctionPlayer } from '@stumps/contracts';
import { Badge } from '@stumps/ui';
import { PortraitImage } from '@/components/cards/PortraitImage';
import { formatRupees, fullRupees } from './money';
import { PLAYER_ROLE_LABELS } from './useSetup';

/** One pool player: portrait (ADR-017), name, role, status tags and prices. */
export function PlayerLine({
  player,
  children,
}: {
  player: AuctionPlayer;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-overlay">
        <PortraitImage src={player.portraitUrl} alt={player.portraitAlt} sizes="44px" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-semibold break-words text-ink">{player.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
          <span>{PLAYER_ROLE_LABELS[player.role]}</span>
          <Badge tone={player.cappedStatus === 'capped' ? 'auction' : 'neutral'}>
            {player.cappedStatus === 'capped'
              ? 'Capped'
              : player.cappedStatus === 'uncapped'
                ? 'Uncapped'
                : 'Status unknown'}
          </Badge>
          {player.overseas ? <Badge tone="warning">Overseas</Badge> : null}
          <span title={fullRupees(player.basePriceRupees)}>
            Base {formatRupees(player.basePriceRupees)}
            {player.priceSource === 'not_registered' ? ' (not registered since 2024)' : ''}
            {player.priceSource === 'demo' ? ' (demo)' : ''}
          </span>
          {player.currentSalaryRupees ? (
            <span title={fullRupees(player.currentSalaryRupees)}>
              · 2026 salary {formatRupees(player.currentSalaryRupees)}
            </span>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
