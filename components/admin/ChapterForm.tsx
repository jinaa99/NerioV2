'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Button, Icon, Segmented } from '@/components/ui';
import { CHAPTER_STATUS_LABEL, CHAPTER_STATUS_TONE, chapterNo } from '@/lib/catalog';
import type { FormState } from '@/server/actions/auth';
import {
  addPagesAction, createChapterAction, deleteChapterAction, deletePageAction, reorderPagesAction, updateChapterAction,
} from '@/server/actions/catalog';
import type { AdminChapterDTO } from '@/server/data/catalog';
import { Field, FormError, Section, fieldError, fromLocalInput, inputStyle, textareaStyle, toLocalInput } from './Form';
import { useAdmin } from './store';

type Values = { number: string; title: string; access: 'free' | 'early_access'; freeAt: string; status: 'draft' | 'published'; publishedAt: string };

export default function ChapterForm({ series, chapter, nextNumber, justSaved }: {
  series: { id: string; title: string; slug: string };
  chapter?: AdminChapterDTO;
  nextNumber?: number;
  justSaved?: boolean;
}) {
  const { toast } = useAdmin();
  const editing = !!chapter;
  const action = editing ? updateChapterAction.bind(null, chapter.id) : createChapterAction.bind(null, series.id);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [v, setV] = useState<Values>(() => ({
    number: chapter ? chapterNo(chapter.number) : String(nextNumber ?? 1),
    title: chapter?.title ?? '',
    access: chapter?.access ?? 'free',
    freeAt: toLocalInput(chapter?.freeAt),
    status: chapter?.status === 'published' ? 'published' : 'draft',
    publishedAt: toLocalInput(chapter?.publishedAt),
  }));
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV(prev => ({ ...prev, [k]: val }));
  const err = (name: string) => fieldError(state, name);

  const shown = useRef(false);
  useEffect(() => {
    if (justSaved && !shown.current) { shown.current = true; toast('Chapter created. Add its pages below.'); }
  }, [justSaved, toast]);
  useEffect(() => {
    if (state.ok) toast('Chapter saved');
    else if (state.error) toast(state.error, 'error', 'var(--danger)');
  }, [state, toast]);

  const pipeline = chapter && chapter.status !== 'draft' && chapter.status !== 'published' ? chapter.status : null;
  const future = v.publishedAt && new Date(v.publishedAt) > new Date();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('publishedAt', fromLocalInput(v.publishedAt));
    fd.set('freeAt', v.access === 'early_access' ? fromLocalInput(v.freeAt) : '');
    startSave(() => formAction(fd));
  };
  const remove = () => {
    if (!chapter || !confirm(`Delete chapter ${chapterNo(chapter.number)} and its ${chapter.pages.length} pages? This can’t be undone.`)) return;
    startDelete(async () => {
      const res = await deleteChapterAction(chapter.id);
      if (!res.ok) toast(res.error, 'error', 'var(--danger)');
    });
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <form onSubmit={submit} className="stack" style={{ gap: 20 }} noValidate>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/admin/chapters?series=${series.id}`} className="row" style={{ gap: 4, color: 'var(--ink-2)', font: '500 13px var(--sans)' }}><Icon name="arrow_back" size={18} />{series.title}</Link>
          <div className="grow" />
          {editing && chapter.status === 'published' && (
            <Link href={`/read/${series.slug}/${chapterNo(chapter.number)}`} target="_blank" className="btn btn-ghost" style={{ '--h': '36px', '--fs': '13px', gap: 6 } as React.CSSProperties}><Icon name="open_in_new" size={16} />Open in reader</Link>
          )}
          <Button type="submit" variant="primary" h={36} fs={13} loading={pending} icon="check">{editing ? 'Save chapter' : 'Create chapter'}</Button>
        </div>
        <FormError message={state.error} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 20, alignItems: 'start' }}>
          <Section title="Chapter">
            <Field label="Number" htmlFor="number" error={err('number')} hint="Decimals allowed for bonus chapters, e.g. 12.5.">
              <input id="number" name="number" type="number" step="0.01" min="0" inputMode="decimal" className={`input mono ${err('number') ? 'invalid' : ''}`} style={inputStyle} required value={v.number} onChange={e => set('number', e.target.value)} />
            </Field>
            <Field label="Title" htmlFor="title" error={err('title')} hint="Optional. Shown as “Chapter N” when empty.">
              <input id="title" name="title" className="input" style={inputStyle} maxLength={200} value={v.title} onChange={e => set('title', e.target.value)} />
            </Field>
            <Field label="Access" htmlFor="access" error={err('access')}>
              <Segmented role="radio" label="Access" h={40} stretch options={[['free', 'Free'], ['early_access', 'Early access']]} value={v.access} onChange={a => set('access', a)} />
              <input type="hidden" name="access" value={v.access} />
            </Field>
            {v.access === 'early_access' && (
              <Field label="Free for everyone from" htmlFor="freeAt" error={err('freeAt')} hint="Premium readers get it as soon as it’s published.">
                <input id="freeAt" type="datetime-local" className={`input ${err('freeAt') ? 'invalid' : ''}`} style={inputStyle} value={v.freeAt} onChange={e => set('freeAt', e.target.value)} />
              </Field>
            )}
          </Section>

          <Section title="Publishing" aside={pipeline && <span className={`badge xs ${CHAPTER_STATUS_TONE[pipeline]}`}>{CHAPTER_STATUS_LABEL[pipeline]}</span>}>
            <Field label="State" htmlFor="status" error={err('status')} span
              hint={pipeline ? 'This chapter is in the processing pipeline. Saving as draft keeps its pipeline state.' : v.status === 'draft' ? 'Hidden from readers.' : future ? 'Scheduled: goes live at the date below.' : 'Live for readers.'}>
              <Segmented role="radio" label="State" h={40} stretch options={[['draft', 'Draft'], ['published', 'Published']]} value={v.status} onChange={s => set('status', s)} />
              <input type="hidden" name="status" value={v.status} />
            </Field>
            <Field label={v.status === 'published' ? 'Publication date' : 'Planned publication date'} htmlFor="publishedAt" error={err('publishedAt')} span
              hint={v.status === 'published' ? 'Empty publishes now. A future date schedules the chapter.' : 'Optional. Used when you publish.'}>
              <div className="row" style={{ gap: 8 }}>
                <input id="publishedAt" type="datetime-local" className="input" style={inputStyle} value={v.publishedAt} onChange={e => set('publishedAt', e.target.value)} />
                {v.publishedAt && <Button variant="ghost" h={40} fs={13} onClick={() => set('publishedAt', '')}>Clear</Button>}
              </div>
            </Field>
          </Section>
        </div>
      </form>

      {editing
        ? <PagesManager key={chapter.pages.map(p => p.id).join()} chapterId={chapter.id} pages={chapter.pages} />
        : <div className="a-card row" style={{ padding: 20, gap: 10, color: 'var(--ink-3)', fontSize: 13 }}><Icon name="info" size={18} />Pages can be added after the chapter is created.</div>}

      {editing && (
        <section className="a-card stack" style={{ padding: 20, gap: 10, borderColor: 'rgba(229,103,92,.25)' }}>
          <span style={{ font: '600 14px var(--sans)' }}>Delete chapter</span>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Removes the chapter, its pages and reading progress that points to it.</span>
          <div><Button variant="danger" h={36} fs={13} icon="delete" loading={deleting} onClick={remove}>Delete chapter</Button></div>
        </section>
      )}
    </div>
  );
}

/* Pages */

type Page = AdminChapterDTO['pages'][number];

/** Load an image in the browser to read its natural size. */
function measure(url: string): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error('timeout')), 20_000);
    img.onload = () => { clearTimeout(t); resolve({ url, width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(t); reject(new Error('load failed')); };
    img.src = url;
  });
}

function PagesManager({ chapterId, pages }: { chapterId: string; pages: Page[] }) {
  const { toast } = useAdmin();
  const router = useRouter();
  const [order, setOrder] = useState(pages);
  const [urls, setUrls] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, startSaving] = useTransition();
  const [drag, setDrag] = useState<number | null>(null);
  const dirty = order.some((p, i) => p.id !== pages[i]?.id);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder(o => {
      const next = [...o];
      const [p] = next.splice(from, 1);
      next.splice(to, 0, p);
      return next;
    });
  };

  const saveOrder = () => startSaving(async () => {
    const res = await reorderPagesAction(chapterId, order.map(p => p.id));
    if (res.ok) { toast('Page order saved'); router.refresh(); } else toast(res.error, 'error', 'var(--danger)');
  });

  const remove = (p: Page) => {
    if (!confirm(`Remove page ${p.pageNumber}?`)) return;
    startSaving(async () => {
      const res = await deletePageAction(p.id);
      if (res.ok) { toast(`Page ${p.pageNumber} removed`); router.refresh(); } else toast(res.error, 'error', 'var(--danger)');
    });
  };

  const add = async () => {
    const list = urls.split('\n').map(s => s.trim()).filter(Boolean);
    if (list.length === 0) return;
    const bad = list.filter(u => !/^https:\/\/\S+$/.test(u));
    if (bad.length) return toast(`Not an https URL: ${bad[0]}`, 'error', 'var(--danger)');
    setAdding(true);
    const results = await Promise.allSettled(list.map(measure));
    const failed = list.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) {
      setAdding(false);
      return toast(`${failed.length} image${failed.length > 1 ? 's' : ''} didn’t load: ${failed[0]}`, 'broken_image', 'var(--danger)');
    }
    const measured = results.map(r => (r as PromiseFulfilledResult<{ url: string; width: number; height: number }>).value);
    const res = await addPagesAction(chapterId, measured);
    setAdding(false);
    if (res.ok) { setUrls(''); toast(`${measured.length} page${measured.length > 1 ? 's' : ''} added`); router.refresh(); } else toast(res.error, 'error', 'var(--danger)');
  };

  return (
    <section className="a-card stack">
      <div className="a-section-head">
        <span style={{ font: '600 14px var(--sans)' }}>Pages <span className="meta" style={{ marginLeft: 6 }}>{pages.length}</span></span>
        {dirty && (
          <div className="row" style={{ gap: 8 }}>
            <Button variant="ghost" h={32} fs={12} onClick={() => setOrder(pages)}>Reset</Button>
            <Button variant="primary" h={32} fs={12} icon="check" loading={saving} onClick={saveOrder}>Save order</Button>
          </div>
        )}
      </div>
      <div className="stack" style={{ padding: 20, gap: 20 }}>
        {order.length === 0
          ? <div className="stack" style={{ alignItems: 'center', gap: 6, padding: '24px 0', color: 'var(--ink-3)', fontSize: 13 }}><Icon name="image" size={26} />No pages yet. Add image URLs below.</div>
          : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(132px,1fr))', gap: 12 }}>
              {order.map((p, i) => (
                <li key={p.id} draggable onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}
                  className="stack" style={{ gap: 6, opacity: drag === i ? .4 : 1, cursor: 'grab' }}>
                  <div style={{ position: 'relative', aspectRatio: '3/4', borderRadius: 8, overflow: 'hidden', background: 'var(--s2)', border: p.id !== pages[i]?.id ? '1px solid var(--ember)' : '1px solid var(--line-1)' }}>
                    {p.src
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts; next/image would need each one configured
                      ? <img src={p.src} alt={`Page ${i + 1}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                      : <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--ink-4)' }}><Icon name="hide_image" /></div>}
                    <span className="badge dark xs" style={{ position: 'absolute', left: 6, top: 6 }}>{i + 1}</span>
                  </div>
                  <div className="row" style={{ gap: 2, justifyContent: 'space-between' }}>
                    <span style={{ font: '400 10px var(--mono)', color: 'var(--ink-3)' }}>{p.width}×{p.height}</span>
                    <span className="row">
                      <button type="button" className="icon-btn" style={{ '--h': '26px' } as React.CSSProperties} aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="chevron_left" size={18} /></button>
                      <button type="button" className="icon-btn" style={{ '--h': '26px' } as React.CSSProperties} aria-label="Move later" disabled={i === order.length - 1} onClick={() => move(i, i + 1)}><Icon name="chevron_right" size={18} /></button>
                      <button type="button" className="icon-btn" style={{ '--h': '26px', color: 'var(--danger-text)' } as React.CSSProperties} aria-label={`Remove page ${i + 1}`} disabled={dirty || saving} onClick={() => remove(p)}><Icon name="delete" size={16} /></button>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        {dirty && <span className="meta" style={{ color: 'var(--ember-text)' }}>DRAG OR USE THE ARROWS, THEN SAVE THE NEW ORDER.</span>}

        <div className="field" style={{ borderTop: '1px solid var(--line-1)', paddingTop: 16 }}>
          <label className="label" htmlFor="page-urls">Add pages</label>
          <textarea id="page-urls" className="input mono" rows={4} style={{ ...textareaStyle, fontSize: 12 }} placeholder={'https://cdn.example.com/ch12/001.webp\nhttps://cdn.example.com/ch12/002.webp'}
            value={urls} onChange={e => setUrls(e.target.value)} disabled={adding} />
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>One https image URL per line, in reading order. They’re appended after the last page; sizes are read automatically.</span>
          <div><Button variant="secondary" h={36} fs={13} icon="add_photo_alternate" loading={adding} disabled={!urls.trim() || dirty} onClick={add}>Add pages</Button></div>
        </div>
      </div>
    </section>
  );
}
