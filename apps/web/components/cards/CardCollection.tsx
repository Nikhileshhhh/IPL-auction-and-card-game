'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton, StatusMessage } from '@stumps/ui';
import { RARITIES, type PublicCardDTO, type Rarity } from '@stumps/contracts';
import { api } from '@/lib/api-client';
import { CardDetailDialog } from './CardDetail';
import { PremiumCricketCard, RARITY_NAMES } from './PremiumCricketCard';

interface Page {
  dataLabel: string;
  items: PublicCardDTO[];
  nextCursor: string | null;
}

/** Card pool browser (S08 preview / collection): showcase per rarity, filter, detail drawer. */
export function CardCollection() {
  const [showcase, setShowcase] = useState<{ dataLabel: string; items: PublicCardDTO[] } | null>(
    null,
  );
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [list, setList] = useState<{
    key: string;
    items: PublicCardDTO[];
    nextCursor: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicCardDTO | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void api<{ dataLabel: string; items: PublicCardDTO[] }>('/catalog/showcase').then((res) => {
      if (res.ok) setShowcase(res.data);
      else setError(res.error.message);
    });
  }, []);

  useEffect(() => {
    let live = true;
    const qs = rarity === 'all' ? '' : `?rarity=${rarity}`;
    void api<Page>(`/catalog/cards${qs}`).then((res) => {
      if (!live) return;
      if (res.ok) setList({ key: rarity, items: res.data.items, nextCursor: res.data.nextCursor });
    });
    return () => {
      live = false;
    };
  }, [rarity]);

  const loadMore = useCallback(async () => {
    if (!list?.nextCursor) return;
    setLoadingMore(true);
    const qs = new URLSearchParams({
      cursor: list.nextCursor,
      ...(rarity === 'all' ? {} : { rarity }),
    });
    const res = await api<Page>(`/catalog/cards?${qs.toString()}`);
    setLoadingMore(false);
    if (res.ok) {
      setList((prev) =>
        prev && prev.key === rarity
          ? {
              key: rarity,
              items: [...prev.items, ...res.data.items],
              nextCursor: res.data.nextCursor,
            }
          : prev,
      );
    }
  }, [list, rarity]);

  if (error) {
    return (
      <StatusMessage tone="info" title="No card pool yet">
        {error} An administrator publishes the player catalog from the admin console.
      </StatusMessage>
    );
  }

  const current = list && list.key === rarity ? list : null;

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="showcase-heading">
        <h2 id="showcase-heading" className="text-xl font-semibold">
          Six rarities
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          {showcase?.dataLabel ?? 'Loading…'} · Rarity changes the frame only, never the ratings.
        </p>
        <div className="-mx-[var(--gutter)] mt-4 flex snap-x gap-4 overflow-x-auto px-[var(--gutter)] pb-3">
          {showcase
            ? showcase.items.map((card, i) => (
                <button
                  key={card.definitionId}
                  type="button"
                  className="snap-start rounded-[var(--radius-card-art)] text-left"
                  onClick={() => setSelected(card)}
                  aria-label={`Open ${RARITY_NAMES[card.rarity]} card details: ${card.players.map((p) => p.name).join(' & ')}`}
                >
                  <PremiumCricketCard card={card} size="compact" priority={i < 2} />
                </button>
              ))
            : Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="aspect-[5/7] w-[240px] shrink-0" />
              ))}
        </div>
      </section>

      <section aria-labelledby="pool-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="pool-heading" className="text-xl font-semibold">
            Player pool
          </h2>
          <label className="flex items-center gap-2 text-sm">
            Rarity
            <select
              value={rarity}
              onChange={(e) => setRarity(e.target.value as Rarity | 'all')}
              className="min-h-11 rounded-[var(--radius-control)] border border-control bg-midnight px-3"
            >
              <option value="all">All</option>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {RARITY_NAMES[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] justify-items-center gap-5">
          {(current?.items ?? []).map((card) => (
            <li key={card.definitionId}>
              <button
                type="button"
                className="rounded-[var(--radius-card-art)] text-left"
                onClick={() => setSelected(card)}
                aria-label={`Open card details: ${card.players.map((p) => p.name).join(' & ')}`}
              >
                <PremiumCricketCard card={card} size="compact" />
              </button>
            </li>
          ))}
        </ul>
        {current?.nextCursor ? (
          <Button
            variant="secondary"
            className="self-center"
            pending={loadingMore}
            onClick={() => void loadMore()}
          >
            Show more cards
          </Button>
        ) : null}
      </section>

      <CardDetailDialog card={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
