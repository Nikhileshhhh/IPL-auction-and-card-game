import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverGet } from '@/lib/bff/server-session';
import { SignOutButton } from '@/components/shell/SignOutButton';

export const dynamic = 'force-dynamic';

/** Admin area: DB-assigned role + AAL2 re-checked server-side per request. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const me = await serverGet<{ role: string }>('/v1/admin/me', 'admin');
  if (!me.ok) redirect('/admin/login');
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <nav
        aria-label="Administration"
        className="border-b border-line bg-raised p-4 lg:w-[220px] lg:border-r lg:border-b-0"
      >
        <p className="text-xs tracking-widest text-ink-3 uppercase">STUMPS operations</p>
        <p className="mt-1 text-sm text-ink-2">Role: {me.data.role.replace('_', ' ')}</p>
        <ul className="mt-4 flex flex-wrap gap-1 lg:flex-col">
          <li>
            <Link
              href="/admin"
              className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-overlay"
            >
              Access
            </Link>
          </li>
        </ul>
        <div className="mt-4">
          <SignOutButton scope="admin" />
        </div>
      </nav>
      <main id="main" className="flex-1 px-[var(--gutter)] py-8">
        {children}
      </main>
    </div>
  );
}
