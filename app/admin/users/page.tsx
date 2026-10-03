import type { Metadata } from 'next';
import Users from '@/components/admin/Users';
import { pageOffset, param } from '@/components/Pager';
import { requireAdminPage } from '@/server/auth/guards';
import { USER_FILTERS, listUsers, type UserFilter } from '@/server/data/account';
import { countPendingPayments, listPayments } from '@/server/data/billing';

export const metadata: Metadata = { title: 'Users & payments' };
const LIMIT = 25;

export default async function Page({ searchParams }: PageProps<'/admin/users'>) {
  const actor = await requireAdminPage('/admin/users');
  const sp = await searchParams;
  const offset = pageOffset(sp.page, LIMIT);
  const pendingPayments = await countPendingPayments();

  if (param(sp.tab) === 'payments') {
    const requested = param(sp.status);
    const payStatus = requested === 'confirmed' || requested === 'rejected' ? requested : 'pending';
    const payments = await listPayments({ status: payStatus, limit: LIMIT, offset });
    return <Users tab="payments" payments={payments} payStatus={payStatus} pendingPayments={pendingPayments} currentUserId={actor.userId} />;
  }
  const q = (param(sp.q) ?? '').slice(0, 100);
  const filter: UserFilter = (USER_FILTERS as readonly string[]).includes(param(sp.filter) ?? '') ? (param(sp.filter) as UserFilter) : 'all';
  const users = await listUsers({ q: q || undefined, filter, limit: LIMIT, offset });
  return <Users tab="users" users={users} q={q} filter={filter} pendingPayments={pendingPayments} currentUserId={actor.userId} />;
}
