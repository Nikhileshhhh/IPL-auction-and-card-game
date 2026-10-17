import type { Metadata } from 'next';
import { CleanupQueue } from '@/components/admin/CleanupQueue';

export const metadata: Metadata = { title: 'Room cleanup' };

/** S33 operations: the recoverable room-deletion queue. */
export default function CleanupPage() {
  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Room cleanup</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Finished, aborted and abandoned rooms are deleted automatically: files first, then every
        temporary record. Rooms that could not be deleted yet wait here and retry on their own.
      </p>
      <div className="mt-8">
        <CleanupQueue />
      </div>
    </div>
  );
}
