import { RoomCreationForm } from '@/features/room/components/RoomCreationForm';

export const metadata = { title: 'Create a Card Battle room' };

/** S05 — card room creation. */
export default function CreateCardRoomPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          Create a Card Battle room
        </h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Set the table, then share the generated room code. Nobody can join without it.
        </p>
      </header>
      <RoomCreationForm />
    </div>
  );
}
