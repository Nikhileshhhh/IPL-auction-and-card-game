import { RoomJoinForm } from '@/features/room/components/RoomJoinForm';

export const metadata = { title: 'Join a Card Battle room' };

/** S06 — card room joining. There is no public room directory. */
export default function JoinCardRoomPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          Join a Card Battle room
        </h1>
        <p className="mt-2 max-w-2xl text-ink-2">Enter the code your host shared with you.</p>
      </header>
      <RoomJoinForm gameType="card" />
    </div>
  );
}
