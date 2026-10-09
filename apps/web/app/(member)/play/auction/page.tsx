import { AppShell } from '@/components/shell/AppShell';
import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Mega Auction' };

export default function AuctionHubPage() {
  return (
    <AppShell>
      <PlaceholderPanel title="Mega Auction" feature="megaAuction" />
    </AppShell>
  );
}
