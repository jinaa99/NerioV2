'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui';
import { PAYMENTS, PLAN_TONE, USERS } from '@/lib/admin-data';
import { tone } from '@/lib/data';
import { useAdmin } from './store';

function Col({ label, children, min, color }: { label: string; children: React.ReactNode; min: number; color?: string }) {
  return (
    <div className="stack" style={{ gap: 2, minWidth: min }}>
      <span style={{ font: '400 10px var(--mono)', color: 'var(--ink-3)' }}>{label}</span>
      <span style={{ font: '500 13px var(--mono)', color }}>{children}</span>
    </div>
  );
}

export default function Users() {
  const { pays, setPay, toast } = useAdmin();
  const router = useRouter();
  const path = usePathname();
  const tab = useSearchParams().get('tab') === 'payments' ? 1 : 0;
  const pending = pays.filter(p => p === 'pending').length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div role="tablist" className="tabs" style={{ gap: 24 }}>
        {(['All users', 'Pending payments'] as const).map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={tab === i} style={{ fontSize: 14, paddingBottom: 12 }} onClick={() => router.replace(i ? `${path}?tab=payments` : path)}>
            {label}
            {i === 1 && pending > 0 && <span style={{ font: '500 11px var(--mono)', padding: '1px 6px', borderRadius: 999, background: 'rgba(232,130,95,.16)', color: 'var(--ember-text)' }}>{pending}</span>}
          </button>
        ))}
      </div>

      {tab === 0 && (
        <div className="a-table-wrap">
          <table className="a-table" style={{ minWidth: 680 }}>
            <thead><tr><th>USER</th><th>PLAN</th><th style={{ textAlign: 'right' }}>CHAPTERS</th><th>LAST ACTIVE</th><th>JOINED</th></tr></thead>
            <tbody>
              {USERS.map(([name, email, plan, ch, last, joined, hue]) => (
                <tr key={email}>
                  <td><div className="row" style={{ gap: 10 }}>
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: tone(hue), display: 'grid', placeItems: 'center', font: '600 12px var(--sans)' }}>{name[0]}</span>
                    <div className="stack"><span style={{ fontWeight: 600 }}>{name}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{email}</span></div>
                  </div></td>
                  <td><span className={`badge xs ${PLAN_TONE[plan]}`}>{plan}</span></td>
                  <td className="num">{ch}</td>
                  <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-2)' }}>{last}</td>
                  <td style={{ font: '400 12px var(--mono)', color: 'var(--ink-3)' }}>{joined}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 1 && (
        <div className="stack" style={{ gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Match each claim against your bank statement using the reference code, then confirm to activate Premium.</span>
          {PAYMENTS.map(([name, code, ref, plan, amount, when, hue], i) => {
            const st = pays[i];
            return (
              <div key={code} className="a-card row" style={{ gap: 14, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 14, opacity: st === 'pending' ? 1 : .7, transition: 'opacity .3s' }}>
                <span style={{ width: 32, height: 32, borderRadius: '50%', background: tone(hue), display: 'grid', placeItems: 'center', font: '600 13px var(--sans)', flex: 'none' }}>{name[0]}</span>
                <div className="stack" style={{ flex: '1 1 160px', gap: 2 }}><span style={{ font: '600 14px var(--sans)' }}>{name}</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{when}</span></div>
                <Col label="CODE" min={120} color="var(--ember-text)">{code}</Col>
                <Col label="BANK REF" min={130}>{ref}</Col>
                <Col label={plan.toUpperCase()} min={80}><span style={{ fontSize: 14 }}>{amount}</span></Col>
                {st === 'pending' ? (
                  <div className="row" style={{ gap: 6 }}>
                    <Button variant="outline" h={34} px={12} style={{ color: 'var(--ink-2)' }} onClick={() => { setPay(i, 'declined'); toast(`${name} notified: transfer not found`, 'mail', 'var(--warning)'); }}>Not received</Button>
                    <Button variant="primary" h={34} px={12} onClick={() => { setPay(i, 'confirmed'); toast(`Premium activated for ${name}`); }}>Confirm</Button>
                  </div>
                ) : (
                  <span className={`badge xs ${st === 'confirmed' ? 'success' : 'danger'}`} style={{ padding: '4px 8px', borderRadius: 6 }}>{st === 'confirmed' ? 'CONFIRMED · ACTIVE' : 'MARKED NOT RECEIVED'}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
