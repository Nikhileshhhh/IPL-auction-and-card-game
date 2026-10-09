import type { MemberSummaryDTO } from '@stumps/contracts';
import { Surface } from '@stumps/ui';

export function FriendsStrip({ friends }: { friends: MemberSummaryDTO['friends'] }) {
  return (
    <Surface aria-labelledby="friends-heading">
      <h2 id="friends-heading" className="text-xl font-semibold">
        Friends
      </h2>
      {friends.accepted === 0 ? (
        <p className="mt-2 text-sm text-ink-2">
          You have no friends added yet. Share a room code with someone you know to play together;
          friend lists open with the social features.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-2">
          {friends.accepted} friend{friends.accepted === 1 ? '' : 's'}
          {friends.pendingIncoming > 0
            ? ` · ${friends.pendingIncoming} request${friends.pendingIncoming === 1 ? '' : 's'} waiting`
            : ''}
        </p>
      )}
    </Surface>
  );
}
