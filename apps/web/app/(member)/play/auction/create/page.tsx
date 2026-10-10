import { AuctionCreationForm } from '@/features/room/components/AuctionCreationForm';

export const metadata = { title: 'Create a Mega Auction room' };

/** S14 — auction room creation (ruleset validation lands with the auction engine). */
export default function CreateAuctionRoomPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          Create a Mega Auction room
        </h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Choose the rule season and pacing. Friends join the room first, then pick franchises.
        </p>
      </header>
      <AuctionCreationForm />
    </div>
  );
}
