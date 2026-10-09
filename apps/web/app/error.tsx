'use client';

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-8" id="main">
      <div role="alert" className="rounded-[var(--radius-panel)] border border-line bg-raised p-8">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-ink-2">
          Your game state lives on the server and is unaffected. You can retry this view.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 min-h-12 rounded-lg bg-card px-5 font-semibold text-base"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
