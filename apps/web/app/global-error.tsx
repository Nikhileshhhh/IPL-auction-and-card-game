'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{ background: '#07111F', color: '#F4F7FB', fontFamily: 'system-ui, sans-serif' }}
      >
        <main style={{ maxWidth: 560, margin: '64px auto', padding: 24 }}>
          <h1>STUMPS is temporarily unavailable</h1>
          <p>Please retry. No game action was lost by this page error.</p>
          <button type="button" onClick={reset} style={{ minHeight: 48, padding: '0 20px' }}>
            Retry
          </button>
        </main>
      </body>
    </html>
  );
}
