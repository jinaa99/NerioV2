import 'server-only';
/**
 * Translation reference data: glossary and characters.
 * Only data access lives here; nothing runs OCR or models (the AI pipeline is a later phase).
 */
import { asc, eq } from 'drizzle-orm';
import { characterInput, glossaryTermInput, uuid, type CharacterInput, type GlossaryTermInput } from '@/lib/validation';
import { requireRole } from '../auth/actor';
import { db } from '../db/client';
import { characters, glossaryTerms } from '../db/schema';
import { parseInput, rethrowUnique } from '../errors';

// Jobs, the review queue and segment review live in ./pipeline.ts.

/* Glossary & characters: staff-only reference data per series. */

export async function listGlossary(seriesId: string) {
  await requireRole('translator');
  const id = parseInput(uuid, seriesId);
  return db()
    .select({ id: glossaryTerms.id, sourceTerm: glossaryTerms.sourceTerm, targetTerm: glossaryTerms.targetTerm, notes: glossaryTerms.notes, caseSensitive: glossaryTerms.caseSensitive })
    .from(glossaryTerms).where(eq(glossaryTerms.seriesId, id)).orderBy(asc(glossaryTerms.sourceTerm));
}

export async function upsertGlossaryTerm(input: GlossaryTermInput) {
  const actor = await requireRole('translator');
  const data = parseInput(glossaryTermInput, input);
  const [row] = await db().insert(glossaryTerms).values({ ...data, createdBy: actor.userId })
    .onConflictDoUpdate({ target: [glossaryTerms.seriesId, glossaryTerms.sourceTerm], set: { targetTerm: data.targetTerm, notes: data.notes, caseSensitive: data.caseSensitive } })
    .returning({ id: glossaryTerms.id });
  return row;
}

export async function deleteGlossaryTerm(termId: string) {
  await requireRole('translator');
  await db().delete(glossaryTerms).where(eq(glossaryTerms.id, parseInput(uuid, termId)));
}

export async function listCharacters(seriesId: string) {
  await requireRole('translator');
  const id = parseInput(uuid, seriesId);
  return db()
    .select({ id: characters.id, name: characters.name, nativeName: characters.nativeName, aliases: characters.aliases, description: characters.description, voiceNotes: characters.voiceNotes })
    .from(characters).where(eq(characters.seriesId, id)).orderBy(asc(characters.name));
}

export async function createCharacter(input: CharacterInput) {
  await requireRole('translator');
  const data = parseInput(characterInput, input);
  try {
    const [row] = await db().insert(characters).values(data).returning({ id: characters.id });
    return row;
  } catch (err) {
    rethrowUnique(err, 'A character with that name already exists in this series.');
  }
}
