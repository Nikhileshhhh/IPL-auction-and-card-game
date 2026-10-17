import type { Metadata } from 'next';
import { UserRestrictions } from '@/components/admin/UserRestrictions';

export const metadata: Metadata = { title: 'Users' };

export default function AdminUsersPage() {
  return (
    <div>
      <h1 className="font-display text-[40px] leading-[46px] font-semibold">Users</h1>
      <p className="mt-2 max-w-3xl text-ink-2">
        Suspend a member or lift a suspension. Their profile, friends and medals stay.
      </p>
      <div className="mt-8">
        <UserRestrictions />
      </div>
    </div>
  );
}
