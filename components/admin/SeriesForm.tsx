'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Button, Cover, Icon } from '@/components/ui';
import { SERIES_STATUS_LABEL, coverBg, type SeriesStatus } from '@/lib/catalog';
import { toSlug } from '@/lib/validation';
import type { FormState } from '@/server/actions/auth';
import { createSeriesAction, deleteSeriesAction, updateSeriesAction } from '@/server/actions/catalog';
import type { AdminSeriesDTO } from '@/server/data/catalog';
import { Field, FormError, Section, fieldError, inputStyle, textareaStyle } from './Form';
import { useAdmin } from './store';

type Values = {
  title: string; slug: string; altTitles: string; description: string; author: string; artist: string;
  status: SeriesStatus; sourceLanguage: string; coverUrl: string; coverHue: number; genres: string[]; tags: string;
};

const EMPTY: Values = { title: '', slug: '', altTitles: '', description: '', author: '', artist: '', status: 'draft', sourceLanguage: 'ko', coverUrl: '', coverHue: 40, genres: [], tags: '' };

const fromDTO = (s: AdminSeriesDTO): Values => ({
  title: s.title, slug: s.slug, altTitles: s.altTitles.join('\n'), description: s.description, author: s.author, artist: s.artist ?? '',
  status: s.status, sourceLanguage: s.sourceLanguage, coverUrl: s.coverUrl?.startsWith('https://') ? s.coverUrl : '', coverHue: s.coverHue, genres: s.genres, tags: s.tags.join(', '),
});

export default function SeriesForm({ series, allGenres, allTags, justSaved }: { series?: AdminSeriesDTO; allGenres: string[]; allTags: string[]; justSaved?: boolean }) {
  const { toast } = useAdmin();
  const editing = !!series;
  const action = editing ? updateSeriesAction.bind(null, series.id) : createSeriesAction;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [v, setV] = useState<Values>(series ? fromDTO(series) : EMPTY);
  const [storedCoverPreview, setStoredCoverPreview] = useState(series?.coverUrl?.startsWith('/api/media/') ? series.coverUrl : '');
  const [coverUploadKey, setCoverUploadKey] = useState('');
  const [slugTouched, setSlugTouched] = useState(editing);
  const [newGenre, setNewGenre] = useState('');
  const [deleting, startDelete] = useTransition();
  const [, startSave] = useTransition();
  const [coverUploading, setCoverUploading] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV(prev => ({ ...prev, [k]: val }));

  const shown = useRef(false);
  useEffect(() => {
    if (justSaved && !shown.current) { shown.current = true; toast('Series created'); }
  }, [justSaved, toast]);
  useEffect(() => {
    if (state.ok) toast('Series saved');
    else if (state.error) toast(state.error, 'error', 'var(--danger)');
  }, [state, toast]);

  const genreOptions = [...new Set([...allGenres, ...v.genres])];
  const toggleGenre = (g: string) => set('genres', v.genres.includes(g) ? v.genres.filter(x => x !== g) : [...v.genres, g]);
  const addGenre = () => {
    const g = newGenre.trim();
    if (g && !v.genres.some(x => x.toLowerCase() === g.toLowerCase())) set('genres', [...v.genres, g]);
    setNewGenre('');
  };
  const remove = () => {
    if (!series || !confirm(`Delete “${series.title}”? It disappears from the site and the admin lists.`)) return;
    startDelete(async () => {
      const res = await deleteSeriesAction(series.id);
      if (!res.ok) toast(res.error, 'error', 'var(--danger)');
    });
  };
  const err = (name: string) => fieldError(state, name);
  const coverPreviewUrl = v.coverUrl ? (/^https:\/\/\S+$/.test(v.coverUrl) ? v.coverUrl.replace(/["\\]/g, encodeURIComponent) : null) : storedCoverPreview || null;
  const uploadCover = async (file?: File) => {
    if (!file) return;
    setCoverUploading(true);
    try {
      const form = new FormData(); if (series) form.set('seriesId', series.id); form.set('file', file);
      const response = await fetch('/api/admin/series/cover', { method: 'POST', body: form });
      const result = await response.json() as { coverUrl?: string; uploadKey?: string; error?: string };
      if (!response.ok || !result.coverUrl) throw new Error(result.error || 'Cover upload failed.');
      set('coverUrl', '');
      setStoredCoverPreview(result.coverUrl!);
      setCoverUploadKey(result.uploadKey ?? '');
      toast('Cover uploaded');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Cover upload failed.', 'error', 'var(--danger)');
    } finally { setCoverUploading(false); }
  };

  return (
    // onSubmit instead of `action`: React resets forms after an action, which would fight the controlled fields.
    <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); startSave(() => formAction(fd)); }} className="stack" style={{ gap: 20 }} noValidate>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Link href="/admin/series" className="row" style={{ gap: 4, color: 'var(--ink-2)', font: '500 13px var(--sans)' }}><Icon name="arrow_back" size={18} />All series</Link>
        <div className="grow" />
        {editing && <>
          {series.status !== 'draft' && <Link href={`/series/${series.slug}`} className="btn btn-ghost" style={{ '--h': '36px', '--fs': '13px', gap: 6 } as React.CSSProperties} target="_blank"><Icon name="open_in_new" size={16} />View on site</Link>}
          <Link href={`/admin/chapters?series=${series.id}`} className="btn btn-outline" style={{ '--h': '36px', '--fs': '13px', gap: 6, borderColor: 'rgba(255,255,255,.1)' } as React.CSSProperties}><Icon name="auto_stories" size={16} />Chapters</Link>
        </>}
        <Button type="submit" variant="primary" h={36} fs={13} loading={pending || coverUploading} disabled={coverUploading} icon="check">{editing ? 'Save changes' : 'Create series'}</Button>
      </div>
      <FormError message={state.error} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,520px),1fr))', gap: 20, alignItems: 'start' }}>
        <div className="stack" style={{ gap: 20 }}>
          <Section title="Details">
            <Field label="Title" htmlFor="title" error={err('title')}>
              <input id="title" name="title" className={`input ${err('title') ? 'invalid' : ''}`} style={inputStyle} required maxLength={200} value={v.title}
                onChange={e => { set('title', e.target.value); if (!slugTouched) set('slug', toSlug(e.target.value)); }} />
            </Field>
            <Field label="Slug" htmlFor="slug" error={err('slug')} hint={`nerio.app/series/${v.slug || '…'}`}>
              <input id="slug" name="slug" className={`input mono ${err('slug') ? 'invalid' : ''}`} style={inputStyle} required maxLength={96} value={v.slug}
                onChange={e => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} />
            </Field>
            <Field label="Alternative titles" htmlFor="altTitles" error={err('altTitles')} hint="One per line: native title, romanization, other English titles." span>
              <textarea id="altTitles" name="altTitles" className="input" rows={3} style={textareaStyle} value={v.altTitles} onChange={e => set('altTitles', e.target.value)} />
            </Field>
            <Field label="Description" htmlFor="description" error={err('description')} hint={`${v.description.length} / 5000`} span>
              <textarea id="description" name="description" className="input" rows={6} maxLength={5000} style={textareaStyle} value={v.description} onChange={e => set('description', e.target.value)} />
            </Field>
            <Field label="Author" htmlFor="author" error={err('author')}>
              <input id="author" name="author" className={`input ${err('author') ? 'invalid' : ''}`} style={inputStyle} required maxLength={120} value={v.author} onChange={e => set('author', e.target.value)} />
            </Field>
            <Field label="Artist" htmlFor="artist" error={err('artist')} hint="Leave empty if the same as the author.">
              <input id="artist" name="artist" className="input" style={inputStyle} maxLength={120} value={v.artist} onChange={e => set('artist', e.target.value)} />
            </Field>
          </Section>

          <Section title="Genres & tags">
            <Field label="Genres" htmlFor="new-genre" error={err('genres')} hint="The first selected genre is the primary one. Up to 8." span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {genreOptions.map(g => {
                  const i = v.genres.indexOf(g);
                  return (
                    <button key={g} type="button" aria-pressed={i >= 0} className="genre-chip" onClick={() => toggleGenre(g)}>
                      {i >= 0 && <span style={{ font: '500 10px var(--mono)', marginRight: 4, opacity: .7 }}>{i + 1}</span>}{g}
                    </button>
                  );
                })}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 4 }}>
                <input id="new-genre" className="input" style={{ ...inputStyle, maxWidth: 240 }} placeholder="New genre" value={newGenre} maxLength={64}
                  onChange={e => setNewGenre(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGenre(); } }} />
                <Button variant="secondary" h={40} fs={13} icon="add" onClick={addGenre} disabled={!newGenre.trim()}>Add</Button>
              </div>
              <input type="hidden" name="genres" value={v.genres.join(',')} />
            </Field>
            <Field label="Tags" htmlFor="tags" error={err('tags')} hint="Comma-separated, e.g. Regression, Female lead. Up to 20." span>
              <input id="tags" name="tags" className="input" style={inputStyle} list="tag-options" value={v.tags} onChange={e => set('tags', e.target.value)} />
              <datalist id="tag-options">{allTags.map(t => <option key={t} value={t} />)}</datalist>
            </Field>
          </Section>
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <Section title="Publishing">
            <Field label="Status" htmlFor="status" error={err('status')} hint={v.status === 'draft' ? 'Drafts are hidden from readers.' : 'Visible to readers.'}>
              <select id="status" name="status" className="input" style={inputStyle} value={v.status} onChange={e => set('status', e.target.value as SeriesStatus)}>
                {(Object.keys(SERIES_STATUS_LABEL) as SeriesStatus[]).map(s => <option key={s} value={s}>{SERIES_STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Source language" htmlFor="sourceLanguage" error={err('sourceLanguage')} hint="BCP-47, e.g. ko, ja, zh-Hans.">
              <input id="sourceLanguage" name="sourceLanguage" className="input mono" style={inputStyle} maxLength={16} value={v.sourceLanguage} onChange={e => set('sourceLanguage', e.target.value)} />
            </Field>
          </Section>

          <Section title="Cover">
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
              <Cover bg={coverBg(v.coverHue, coverPreviewUrl)} width={120} radius={12} tag={coverPreviewUrl ? undefined : 'GENERATED'} style={{ flex: 'none', outline: '1px solid rgba(255,255,255,.1)' }} />
              <div className="stack grow" style={{ gap: 16, minWidth: 200 }}>
                <Field label="Cover image URL" htmlFor="coverUrl" error={err('coverUrl')} hint="https:// link to a 3:4 image. Empty uses the generated cover.">
                  <input id="coverUrl" name="coverUrl" type="url" inputMode="url" className={`input ${err('coverUrl') ? 'invalid' : ''}`} style={inputStyle} placeholder="https://" value={v.coverUrl} onChange={e => { set('coverUrl', e.target.value.trim()); setStoredCoverPreview(''); setCoverUploadKey(''); }} />
                </Field>
                <Field label="Or upload an image" htmlFor="coverFile" hint="JPEG, PNG, or WebP · up to 10 MB. Saved as an optimized WebP.">
                  <input id="coverFile" type="file" accept="image/jpeg,image/png,image/webp" className="input" style={inputStyle} disabled={coverUploading} onChange={e => { void uploadCover(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
                  {coverUploading && <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>Uploading cover…</span>}
                  {!editing && <input type="hidden" name="coverUploadKey" value={coverUploadKey} />}
                </Field>
                <Field label={`Accent hue · ${v.coverHue}°`} htmlFor="coverHue" error={err('coverHue')} hint="Used for the generated cover and page backdrops.">
                  <input id="coverHue" name="coverHue" type="range" min={0} max={360} value={v.coverHue} onChange={e => set('coverHue', +e.target.value)} style={{ accentColor: `oklch(.65 .12 ${v.coverHue})` }} />
                </Field>
              </div>
            </div>
          </Section>

          {editing && (
            <section className="a-card stack" style={{ padding: 20, gap: 10, borderColor: 'rgba(229,103,92,.25)' }}>
              <span style={{ font: '600 14px var(--sans)' }}>Delete series</span>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Removes the series and its chapters from the site. Reading history is kept.</span>
              <div><Button variant="danger" h={36} fs={13} icon="delete" loading={deleting} onClick={remove}>Delete series</Button></div>
            </section>
          )}
        </div>
      </div>
    </form>
  );
}
