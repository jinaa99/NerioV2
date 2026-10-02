import type { Metadata } from 'next';
import AdminShell from '@/components/admin/Shell';
import { AdminProvider } from '@/components/admin/store';
import './admin.css';

export const metadata: Metadata = { title: { default: 'Nerio Admin', template: '%s · Nerio Admin' } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminShell>{children}</AdminShell>
    </AdminProvider>
  );
}
