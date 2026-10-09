import type { Metadata } from 'next';
import { AdminLogin } from '@/components/admin/AdminLogin';

export const metadata: Metadata = { title: 'Administrator sign in' };
export const dynamic = 'force-dynamic';

/** Quiet institutional screen without game art (S32). */
export default function AdminLoginPage() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-[var(--gutter)]">
      <section aria-labelledby="admin-login" className="w-full max-w-[400px]">
        <p className="text-xs tracking-widest text-ink-3 uppercase">STUMPS operations</p>
        <h1 id="admin-login" className="mt-2 text-[28px] leading-[34px] font-semibold">
          Administrator sign in
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          Multi-factor verification is required for every session.
        </p>
        <div className="mt-8">
          <AdminLogin />
        </div>
      </section>
    </main>
  );
}
