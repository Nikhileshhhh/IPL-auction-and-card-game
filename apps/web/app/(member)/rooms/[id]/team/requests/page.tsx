import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Team requests' };

/** S17 shell — collaboration approval ships with team capabilities. */
export default function TeamRequestsPage() {
  return (
    <PlaceholderPanel title="Team requests" feature="teams">
      <p className="mt-4 text-ink-2">
        Captains will approve teammates and choose their permissions here.
      </p>
    </PlaceholderPanel>
  );
}
