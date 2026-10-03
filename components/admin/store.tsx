'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ToastViewport, useToastQueue, type PushToast } from '@/components/ui';

/** Admin UI context: toasts only. All admin data comes from the server per request. */
type AdminCtx = { toast: PushToast };

const Ctx = createContext<AdminCtx | null>(null);
export function useAdmin() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAdmin must be used inside <AdminProvider>');
  return c;
}

export function AdminProvider({ children }: { children: ReactNode }) {
  const { toasts, push, dismiss } = useToastQueue(3000);
  const value = useMemo<AdminCtx>(() => ({ toast: push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} align="right" bottom="20px" />
    </Ctx.Provider>
  );
}
