import { StatusMessage } from '@stumps/ui';
import type { CardGame } from '../arena/model';

/** An end requested mid-chain (rules §6.2): the current contest settles, then the match ends. */
export function FinishPendingNotice({ game }: { game: CardGame }) {
  if (!game.finishPending || game.result) return null;
  return (
    <StatusMessage
      tone="info"
      title={game.finishPending === 'vote' ? 'Ending by vote' : 'Time limit reached'}
    >
      This contest is played out, then the match ends and is ranked by cards held. If it is not
      settled within 60 seconds, the cards in play go back to their owners first.
    </StatusMessage>
  );
}
