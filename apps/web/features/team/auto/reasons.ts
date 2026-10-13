import { formatRupees } from '@/features/auction/setup/money';

/** Plain reasons for automated decisions (S26): rules, not "AI". */
export function reasonText(code: string, ceiling?: string | null): string {
  const limit = ceiling ? ` (${formatRupees(ceiling)})` : '';
  switch (code) {
    case 'BID':
      return `Bid within the limit${limit}`;
    case 'NO_STRATEGY':
      return 'No automated limits are switched on';
    case 'ALREADY_LEADING':
      return 'Already the highest bidder';
    case 'PURCHASES_REACHED':
      return 'Skipped: automated purchase limit reached';
    case 'NOT_TARGET':
      return 'Skipped: not a target and no ceiling for this role';
    case 'ROLE_FILLED':
      return 'Skipped: enough players in this role';
    case 'CAP_REACHED':
      return `Skipped: automated spending cap reached${limit}`;
    case 'RESERVE':
      return `Skipped: purse kept for the minimum squad${limit}`;
    case 'USER_RESERVE':
      return `Skipped: your reserve would be broken${limit}`;
    case 'OVER_CEILING':
      return `Skipped: above the ceiling${limit}`;
    case 'SQUAD_FULL':
      return 'Skipped: squad full';
    case 'OVERSEAS_LIMIT':
      return 'Skipped: overseas limit reached';
    case 'XI_INFEASIBLE':
      return 'Skipped: would leave no legal XI';
    default:
      return code;
  }
}

export const MODE_TEXT = {
  MANUAL: 'People are bidding for your team.',
  FAILOVER: 'Your co-captain holds control while the bidders are away.',
  AUTO: 'Automatic: bidding within your saved limits while everyone is away.',
  OBSERVE: 'Observing: nobody is bidding for your team (no limits saved).',
} as const;

export const MODE_LABELS = {
  MANUAL: 'Manual',
  FAILOVER: 'Co-captain in control',
  AUTO: 'Automatic',
  OBSERVE: 'Observing',
} as const;
