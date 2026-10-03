import 'server-only';
import { inArray } from 'drizzle-orm';
import { cache } from 'react';
import { z } from 'zod';
import { requireRole } from '../auth/actor';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { parseInput } from '../errors';
import { recordAudit } from './audit';

/**
 * Operational settings, stored per key in `app_settings` and validated on read and write.
 * Missing keys fall back to DEFAULTS, so a fresh database works without seeding.
 */
const iban = z.string().trim().toUpperCase().regex(/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,34}$/, 'Enter a valid IBAN').max(42);
const bic = z.string().trim().toUpperCase().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, 'Enter an 8 or 11 character BIC');

export const settingsSchema = z.object({
  /** Chapters whose every region scores at or above this skip human review (used by pipeline workers). */
  autoPublishThreshold: z.number().min(0.5).max(0.99),
  requireQaForNewSeries: z.boolean(),
  /** Gates the in-app new-chapter notification fan-out on publish. */
  notifyFollowersOnPublish: z.boolean(),
  pausePipeline: z.boolean(),
  ocrEngine: z.enum(['nerio-ocr-v3', 'nerio-ocr-v2']),
  typesetFont: z.enum(['shonen', 'noto-sans']),
  bankHolder: z.string().trim().min(1, 'Required').max(120),
  bankName: z.string().trim().min(1, 'Required').max(120),
  bankIban: iban,
  bankBic: bic,
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = Partial<z.input<typeof settingsSchema>>;

export const DEFAULT_SETTINGS: Settings = {
  autoPublishThreshold: 0.8,
  requireQaForNewSeries: true,
  notifyFollowersOnPublish: true,
  pausePipeline: false,
  ocrEngine: 'nerio-ocr-v3',
  typesetFont: 'shonen',
  bankHolder: '',
  bankName: '',
  bankIban: '',
  bankBic: '',
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** All settings, defaults filled in. Memoized per request. Contains no secrets (bank details are shown to readers). */
export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await db().select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, KEYS));
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    const field = settingsSchema.shape[r.key as keyof Settings];
    const parsed = field?.safeParse(r.value);
    if (parsed?.success) merged[r.key] = parsed.data;
  }
  return merged as Settings;
});

/** Admin: change some settings. Each changed key is audited with its old and new value. */
export async function updateSettings(input: SettingsInput) {
  const actor = await requireRole('admin');
  const patch = parseInput(settingsSchema.partial().strict(), input);
  const current = await getSettings();
  const changes = Object.fromEntries(
    (Object.keys(patch) as (keyof Settings)[])
      .filter(k => JSON.stringify(patch[k]) !== JSON.stringify(current[k]))
      .map(k => [k, { from: current[k], to: patch[k] }]),
  );
  const keys = Object.keys(changes);
  if (keys.length === 0) return { changed: [] as string[] };
  await db().transaction(async tx => {
    for (const k of keys) {
      const value = patch[k as keyof Settings];
      await tx.insert(appSettings).values({ key: k, value, updatedBy: actor.userId, updatedAt: new Date() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy: actor.userId, updatedAt: new Date() } });
    }
    await recordAudit(tx, actor, { action: 'settings.update', targetType: 'settings', targetId: keys.join(',').slice(0, 64), metadata: { changes } });
  });
  return { changed: keys };
}
