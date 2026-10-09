import { AuctionArt } from '@/components/game-selection/art';
import { GameHub } from '@/components/game-selection/GameHub';
import { FEATURES } from '@/lib/features';

export const metadata = { title: 'Mega Auction' };

export default function AuctionHubPage() {
  return (
    <GameHub
      title="Mega Auction"
      accent="auction"
      art={<AuctionArt />}
      intro="An IPL-inspired auction simulator. Claim a franchise, invite teammates, and bid for players — each lot shows the player's portrait and ratings."
      enabled={FEATURES.megaAuction}
      createHref="/play/auction/create"
      joinHref="/play/auction/join"
      rules={[
        'Choose a ruleset: a labelled 2025 historical simulation or a casual preset.',
        'Bids follow a fixed increment ladder; late bids extend the clock to at least 8 seconds.',
        'Right-to-match, retentions and squad limits are enforced by the server.',
        'Squads are scored by their best legal XI; incomplete squads cannot win.',
      ]}
    />
  );
}
