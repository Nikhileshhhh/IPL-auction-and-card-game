import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Administrator sign in' };

export default function AdminLoginPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl p-[var(--gutter)] pt-16">
      <PlaceholderPanel title="Administrator sign in" feature="admin" />
    </main>
  );
}
