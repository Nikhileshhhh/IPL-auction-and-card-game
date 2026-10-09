import { AppShell } from '@/components/shell/AppShell';
import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Play' };

export default function PlayPage() {
  return (
    <AppShell>
      <PlaceholderPanel title="Choose your arena" feature="dashboard" />
    </AppShell>
  );
}
