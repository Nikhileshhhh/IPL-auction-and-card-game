import { PlaceholderPanel } from '@/components/shell/PlaceholderPanel';

export const metadata = { title: 'Sign in' };

export default function AuthPage() {
  return (
    <main id="main" className="mx-auto max-w-2xl p-[var(--gutter)] pt-16">
      <PlaceholderPanel title="Sign in" feature="accessGate" />
    </main>
  );
}
