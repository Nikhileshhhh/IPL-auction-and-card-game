import { CardBattleArt } from '@/components/game-selection/art';
import { GameHub } from '@/components/game-selection/GameHub';
import { FEATURES } from '@/lib/features';

export const metadata = { title: 'Card Battle' };

export default function CardsHubPage() {
  return (
    <GameHub
      title="Card Battle"
      accent="card"
      art={<CardBattleArt />}
      intro="A collectible stat-comparison game for 2–8 friends. Every revealed card shows the player's portrait and six game ratings."
      enabled={FEATURES.cardBattle}
      createHref="/play/cards/create"
      joinHref="/play/cards/join"
      rules={[
        'Each round everyone reveals their top card; the selector picks one category.',
        'The highest rating wins every card in the pot; ties grow the pot until resolved.',
        'Decks are dealt fairly from a committed random seed that is revealed after the match.',
        'Win by collecting every card, or rank highest when time or a vote ends the match.',
      ]}
    />
  );
}
