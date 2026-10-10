import { CardCollection } from '@/components/cards/CardCollection';

export const metadata = { title: 'Card pool' };

/** S08 preview / collection: the published card pool with player photos and Game ratings. */
export default function CardPoolPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          Card pool
        </h1>
        <p className="mt-2 max-w-2xl text-ink-2">
          Every card shows the player&apos;s photo and six Game ratings from 0 to 100, calculated
          from real match statistics. The best batter in the pool rates 100 for batting, the best
          bowler 100 for bowling.
        </p>
      </header>
      <CardCollection />
    </div>
  );
}
