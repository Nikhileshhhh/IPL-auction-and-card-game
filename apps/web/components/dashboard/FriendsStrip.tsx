import Link from 'next/link';
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
          You have no friends added yet.{' '}
          <Link href="/friends" className="underline">
            Find people by username
          </Link>{' '}
          and invite them straight into your rooms.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-2">
          <Link href="/friends" className="underline">
            {friends.accepted} friend{friends.accepted === 1 ? '' : 's'}
          </Link>
          {friends.pendingIncoming > 0
            ? ` · ${friends.pendingIncoming} request${friends.pendingIncoming === 1 ? '' : 's'} waiting`
            : ''}
        </p>
      )}
    </Surface>
  );
}
