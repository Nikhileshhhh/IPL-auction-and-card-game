import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverGet } from '@/lib/bff/server-session';
import { SignOutButton } from '@/components/shell/SignOutButton';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Operations' },
  { href: '/admin/access', label: 'Access' },
  { href: '/admin/catalog', label: 'Player catalog' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/announcements', label: 'Announcements' },
  { href: '/admin/cleanup', label: 'Room cleanup' },
  { href: '/admin/design-review', label: 'Design review' },
] as const;

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
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-lg px-3 hover:bg-overlay"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <SignOutButton scope="admin" />
        </div>
      </nav>
      <main id="main" className="min-w-0 flex-1 px-[var(--gutter)] py-8">
        {children}
      </main>
    </div>
  );
}
