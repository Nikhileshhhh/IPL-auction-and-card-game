import { AppShell } from '@/components/shell/AppShell';
import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Card Battle' };

export default function CardsHubPage() {
  return (
    <AppShell>
      <PlaceholderPanel title="Card Battle" feature="cardBattle" />
    </AppShell>
  );
}
