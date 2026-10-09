import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-2">This page does not exist or you do not have access to it.</p>
      <Link href="/play" className="mt-6 inline-flex min-h-11 items-center underline">
        Go to the game selection
      </Link>
    </main>
  );
}
