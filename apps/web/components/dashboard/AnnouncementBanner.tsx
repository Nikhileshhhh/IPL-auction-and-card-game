import type { Announcement } from '@stumps/contracts';

/** Plain-text club announcements (rendered as text nodes, never HTML). */
export function AnnouncementBanner({ items }: { items: Announcement[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Announcements" className="flex flex-col gap-3">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-[var(--radius-panel-sm)] border border-auction/40 bg-raised px-4 py-3"
        >
          <h2 className="font-semibold">{item.title}</h2>
          <p className="mt-1 text-sm whitespace-pre-line text-ink-2">{item.body}</p>
        </article>
      ))}
    </section>
  );
}
