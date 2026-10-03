import type { Metadata } from 'next';
import Premium, { type PlanDTO } from '@/components/site/Premium';
import { getCurrentActor } from '@/server/auth/actor';
import { PLANS, getMyPremiumState } from '@/server/data/billing';
import { getSettings } from '@/server/data/settings';

export const metadata: Metadata = { title: 'Premium' };

export default async function Page() {
  const actor = await getCurrentActor();
  const [settings, state] = await Promise.all([getSettings(), actor ? getMyPremiumState() : Promise.resolve(null)]);
  // Prices come from the server-side price list; the client only ever sends a plan key.
  const plans: PlanDTO[] = (Object.keys(PLANS) as (keyof typeof PLANS)[]).map(key => ({ key, ...PLANS[key] }));
  return <Premium plans={plans} bank={{ holder: settings.bankHolder, bank: settings.bankName, iban: settings.bankIban, bic: settings.bankBic }} state={state} />;
}
