'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Bar, Button, Cover, Icon, IconButton, Segmented, Switch, ToastViewport, useEscape, useToastQueue } from '@/components/ui';
import { STAGES } from '@/lib/admin-data';
import { cover } from '@/lib/data';

const NAV: [string, string][] = [['color', 'Color'], ['type', 'Type'], ['space', 'Space & surface'], ['controls', 'Controls'], ['content', 'Cards & chapters'], ['feedback', 'Feedback'], ['reader', 'Reader'], ['admin', 'Admin'], ['motion', 'Motion']];
const SURFACES: [string, string, string][] = [['#0B0B0D', 'bg / canvas', '#0B0B0D · reader #050506'], ['#111114', 'surface-1', '#111114 · sections'], ['#17171B', 'surface-2', '#17171B · cards, inputs'], ['#1F1F24', 'surface-3', '#1F1F24 · menus, hover'], ['#2A2A30', 'surface-4', '#2A2A30 · pressed, track']];
const INKS: [string, string, string, string][] = [['#EDEBE6', '#0B0B0D', 'ink-1', '#EDEBE6 · 16.9:1'], ['#B4B1AA', '#0B0B0D', 'ink-2', '#B4B1AA · 9.6:1'], ['#8A8780', '#0B0B0D', 'ink-3', '#8A8780 · 5.6:1 meta only'], ['#E8825F', '#1A0D08', 'ember / accent', '#E8825F · progress, new']];
const STATUS: [string, string][] = [['#7BC9A0', 'success'], ['#E6C26A', 'warning'], ['#E5675C', 'danger'], ['#86A9DE', 'info']];
const TYPE_SCALE: [string, string, ReactNode][] = [
  ['display · 72/0.95\n-2.5% · serif', '400 clamp(44px,6vw,72px)/.95 var(--serif)', 'The Lantern Keeper'],
  ['h1 · 44/1.05 · serif', '400 44px/1.05 var(--serif)', 'Continue where you left off'],
  ['h2 · 28/1.15 · serif', '400 28px/1.15 var(--serif)', 'Trending this week'],
  ['h3 · 18/1.3 · 600', '600 18px/1.3 var(--sans)', 'Chapter 112 — The Ninth Gate'],
  ['body · 16/1.6 · 400', '400 16px/1.6 var(--sans)', 'A disgraced lamplighter inherits the last flame in a city that has forgotten night. Every chapter is translated, typeset and checked before it reaches you.'],
  ['small · 14/1.5 · 500', '500 14px/1.5 var(--sans)', 'Fantasy · Drama · Ongoing'],
  ['label · 11 · mono · +10%', '500 11px var(--mono)', 'CH. 112 · 2 HOURS AGO · 64 PAGES'],
];
const MOTION: [string, string][] = [['120ms · press', 'Scale .97 on active. Buttons, chips.'], ['200ms · hover', 'Color and border. Card lift 4px.'], ['240ms · overlay', 'Modals, menus rise 6–8px. Reader chrome slides.'], ['360ms · page', 'Route fade + 8px rise. Pages fade in on load.'], ['cubic-bezier(.2,.8,.2,1)', 'Standard ease-out. Reduced motion: fades only.']];
const SORTS = ['Newest', 'Oldest', 'Most read', 'Unread first'];

function Section({ id, n, kicker, title, intro, children }: { id: string; n: string; kicker: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="stack" style={{ gap: 32, scrollMarginTop: 24 }}>
      <div className="stack" style={{ gap: 8 }}>
        <span className="kicker accent">{n} — {kicker}</span>
        <h2 style={{ font: '400 40px/1.1 var(--serif)', letterSpacing: '-.015em' }}>{title}</h2>
        {intro && <p style={{ fontSize: 15, color: 'var(--ink-3)', maxWidth: 620, lineHeight: 1.6 }}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

const Label = ({ children }: { children: ReactNode }) => <span style={{ font: '600 14px var(--sans)', color: 'var(--ink-2)' }}>{children}</span>;
const Note = ({ children }: { children: ReactNode }) => <span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>{children}</span>;

export default function DesignSystem() {
  const [ddOpen, setDdOpen] = useState(false);
  const [dd, setDd] = useState('Newest');
  const [tab, setTab] = useState(0);
  const [sw, setSw] = useState(true);
  const [modal, setModal] = useState(false);
  const { toasts, push, dismiss } = useToastQueue(2600);
  useEscape(() => { setModal(false); setDdOpen(false); }, modal || ddOpen);

  return (
    <div className="stack" style={{ maxWidth: 1240, margin: '0 auto', padding: 'clamp(24px,5vw,72px) clamp(16px,4vw,48px) 120px', gap: 96 }}>
      <header className="stack" style={{ gap: 28, paddingBottom: 48, borderBottom: '1px solid var(--line-1)' }}>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink-1)', display: 'grid', placeItems: 'center' }}><div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--bg)' }} /></div>
          <span style={{ font: '400 26px var(--serif)', letterSpacing: '-.01em' }}>Nerio</span>
          <span style={{ font: '500 11px var(--mono)', letterSpacing: '.08em', color: 'var(--ink-3)', marginLeft: 8 }}>DESIGN SYSTEM · v1.0 MVP</span>
        </div>
        <h1 style={{ font: '400 clamp(40px,7vw,84px)/1 var(--serif)', letterSpacing: '-.025em', maxWidth: 900, textWrap: 'balance' }}>A quiet frame for loud artwork.</h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 640 }}>Foundations and components for the Nerio reader, discovery surfaces and admin pipeline. Neutral dark surfaces step up in small increments so covers and panels carry all the color. One warm accent marks progress and the next action.</p>
        <nav className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {NAV.map(([id, l]) => <a key={id} href={`#${id}`} className="ds-pill">{l}</a>)}
        </nav>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, fontSize: 14, color: 'var(--ink-3)' }}>
          <span>Screens:</span><Link href="/" className="ds-link">Nerio app</Link><Link href="/admin" className="ds-link">Nerio Admin</Link><Link href="/breakpoints" className="ds-link">Breakpoints</Link>
        </div>
      </header>

      <Section id="color" n="01" kicker="COLOR" title="Surfaces, ink, one accent">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
          {SURFACES.map(([c, name, note], i) => (
            <div key={name} className="stack" style={{ gap: 10 }}>
              <div style={{ height: 96, borderRadius: 12, background: c, border: i < 4 ? `1px solid ${i === 0 ? 'var(--line-2)' : 'var(--line-1)'}` : 'none' }} />
              <div style={{ font: '600 13px var(--sans)' }}>{name}</div><div className="meta">{note}</div>
            </div>
          ))}
          <div className="stack" style={{ gap: 10 }}>
            <div className="stack" style={{ height: 96, borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--line-1)', justifyContent: 'center', gap: 8, padding: '0 14px' }}>
              {['--line-1', '--line-2', '--line-3'].map(v => <div key={v} style={{ height: 1, background: `var(${v})` }} />)}
            </div>
            <div style={{ font: '600 13px var(--sans)' }}>line 1 / 2 / 3</div><div className="meta">white 7% · 12% · 22%</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
          {INKS.map(([c, fg, name, note]) => (
            <div key={name} className="stack" style={{ gap: 10 }}>
              <div style={{ height: 72, borderRadius: 12, background: c, color: fg, padding: 12, font: '500 22px var(--serif)' }}>Aa</div>
              <div style={{ font: '600 13px var(--sans)' }}>{name}</div><div className="meta">{note}</div>
            </div>
          ))}
          {STATUS.map(([c, name]) => (
            <div key={name} className="stack" style={{ gap: 10 }}>
              <div style={{ height: 72, borderRadius: 12, background: c }} />
              <div style={{ font: '600 13px var(--sans)' }}>{name}</div><div className="meta">{c}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 640 }}>Status colors appear as 14% tinted fills with full-strength text, never as large blocks. Accent is reserved: one accent element per view region.</p>
      </Section>

      <Section id="type" n="02" kicker="TYPOGRAPHY" title="Editorial titles, quiet interface">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
          {[['400 48px/1 var(--serif)', 'Newsreader', 'Series titles, section heads, numerals. 400 / italic.'], ['600 40px/1.1 var(--sans)', 'Hanken Grotesk', 'Interface, body, controls. 400 / 500 / 600.'], ['500 34px/1.2 var(--mono)', 'Geist Mono', 'Chapter numbers, metadata, pipeline IDs.']].map(([f, n, d]) => (
            <div key={n} className="card stack" style={{ padding: 24, gap: 8, borderColor: 'var(--line-1)' }}><span style={{ font: f }}>{n}</span><span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{d}</span></div>
          ))}
        </div>
        <div className="stack" style={{ borderTop: '1px solid var(--line-1)' }}>
          {TYPE_SCALE.map(([label, font, sample], i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px,180px) minmax(0,1fr)', gap: 24, alignItems: 'baseline', padding: '20px 0', borderBottom: '1px solid var(--line-1)' }}>
              <span className="meta" style={{ whiteSpace: 'pre-line' }}>{label}</span>
              <span style={{ font, letterSpacing: i < 2 ? '-.02em' : i === 6 ? '.1em' : undefined, color: i === 4 || i === 6 ? 'var(--ink-2)' : undefined, maxWidth: i === 4 ? 620 : undefined }}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="space" n="03" kicker="SPACE, RADIUS, ELEVATION" title="4-point rhythm">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 20 }}>
          {[4, 8, 12, 16, 24, 32, 48, 64, 96].map(n => (
            <div key={n} className="stack" style={{ gap: 8, alignItems: 'center' }}><div style={{ width: n, height: n, background: 'var(--ember)' }} /><Note>{n}</Note></div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 12 }}>
          {[[6, 'r-xs 6', 'badges, tags'], [10, 'r-sm 10', 'buttons, inputs'], [14, 'r-md 14', 'cards, covers'], [20, 'r-lg 20', 'modals, sheets'], [999, 'pill', 'chips, reader bar']].map(([r, n, d]) => (
            <div key={n} className="stack" style={{ height: 110, borderRadius: r as number, background: 'var(--s2)', border: '1px solid var(--line-1)', padding: r === 999 ? '14px 22px' : 14, justifyContent: r === 999 ? 'center' : 'space-between' }}>
              <span style={{ font: '600 13px var(--sans)' }}>{n}</span><span className="meta">{d}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 20, padding: 32, borderRadius: 20, background: 'var(--s1)' }}>
          {[['e0 · flat', 'border only', 'var(--s2)', 'none'], ['e1 · raised', 'menus, hover cards', 'var(--s3)', '0 8px 24px -8px rgba(0,0,0,.6)'], ['e2 · overlay', 'modals, reader bar', 'var(--s3)', '0 24px 64px -16px rgba(0,0,0,.8),0 0 0 1px rgba(0,0,0,.4)']].map(([n, d, bg, sh]) => (
            <div key={n} className="stack" style={{ height: 110, borderRadius: 14, background: bg, border: '1px solid rgba(255,255,255,.08)', boxShadow: sh, padding: 16, justifyContent: 'space-between' }}>
              <span style={{ font: '600 13px var(--sans)' }}>{n}</span><span className="meta">{d}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="controls" n="04" kicker="CONTROLS" title="Buttons, inputs, menus">
        <div className="stack" style={{ gap: 16 }}>
          <Label>Buttons · hover any to try</Label>
          <div className="panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 16, padding: 28 }}>
            {([
              ['PRIMARY', <Button key="p" variant="primary" icon="play_arrow" px={20}>Start reading</Button>],
              ['SECONDARY', <Button key="s" variant="secondary" icon="bookmark">Bookmark</Button>],
              ['ACCENT', <Button key="a" variant="accent">Go Premium</Button>],
              ['GHOST', <Button key="g" variant="ghost" px={14}>View all</Button>],
              ['DANGER', <Button key="d" variant="danger">Reject</Button>],
              ['FOCUS', <Button key="f" variant="secondary" style={{ outline: '2px solid var(--ember)', outlineOffset: 3 }}>Focused</Button>],
              ['LOADING', <Button key="l" variant="primary" loading style={{ opacity: .85 }}>Saving</Button>],
              ['DISABLED', <Button key="x" variant="primary" disabled>Publish</Button>],
              ['ICON · 44', <div key="i" className="row" style={{ gap: 8 }}><IconButton icon="search" label="Search" variant="boxed" /><IconButton icon="more_horiz" label="More" variant="round" style={{ color: 'var(--ink-2)' }} /></div>],
              ['SIZES · 32 / 40 / 52', <div key="z" className="row" style={{ gap: 8 }}><Button h={32} px={12} fs={13}>S</Button><Button h={40} fs={14}>M</Button><Button h={52} px={20}>L</Button></div>],
            ] as [string, ReactNode][]).map(([l, el]) => (
              <div key={l} className="stack" style={{ gap: 10, alignItems: 'flex-start' }}><Note>{l}</Note>{el}</div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
          <div className="panel stack" style={{ gap: 18, padding: 28 }}>
            <Label>Inputs</Label>
            <label className="field"><span className="label">Search</span>
              <span className="searchbox" style={{ padding: '0 14px', gap: 10, borderColor: 'rgba(255,255,255,.1)' }}><Icon name="search" /><input placeholder="Titles, authors, genres" /><span className="kbd">/</span></span>
            </label>
            <label className="field"><span className="label">Focused</span><input className="input" defaultValue="Lantern" style={{ borderColor: 'var(--ember)', boxShadow: '0 0 0 3px rgba(232,130,95,.2)' }} /></label>
            <label className="field"><span className="label">Transaction reference</span><input className="input invalid mono" defaultValue="TRX-88" />
              <span className="row" style={{ font: '500 13px var(--sans)', color: 'var(--danger-text)', gap: 6 }}><Icon name="error" size={16} />Reference must be at least 8 characters.</span>
            </label>
            <label className="field"><span className="label" style={{ color: 'var(--ink-4)' }}>Disabled</span><input className="input" disabled defaultValue="nerio-reader" /></label>
          </div>

          <div className="panel stack" style={{ gap: 18, padding: 28 }}>
            <Label>Dropdown · click</Label>
            <div style={{ position: 'relative' }}>
              <button type="button" aria-expanded={ddOpen} onClick={() => setDdOpen(o => !o)} className="input row" style={{ justifyContent: 'space-between', cursor: 'pointer', fontWeight: 500, padding: '0 12px 0 14px' }}>
                <span>Sort: {dd}</span><Icon name="expand_more" />
              </button>
              {ddOpen && (
                <div role="listbox" className="menu" style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 5, borderRadius: 14 }}>
                  {SORTS.map(o => (
                    <button key={o} type="button" role="option" aria-selected={o === dd} className="menu-item" style={{ height: 40, borderRadius: 8, justifyContent: 'space-between', padding: '0 10px', background: o === dd ? 'rgba(255,255,255,.05)' : undefined }}
                      onClick={() => { setDd(o); setDdOpen(false); }}>
                      <span>{o}</span><Icon name="check" size={18} color="var(--ember)" style={{ opacity: o === dd ? 1 : 0 }} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div style={{ height: 150 }} />
            <button type="button" role="switch" aria-checked={sw} onClick={() => setSw(s => !s)} className="switch-row" style={{ padding: 0, font: '500 15px var(--sans)' }}>
              <span>Auto-hide reader controls</span><Switch on={sw} />
            </button>
            <label className="row" style={{ gap: 10, font: '500 15px var(--sans)' }}>
              <span style={{ width: 20, height: 20, borderRadius: 6, background: 'var(--ink-1)', display: 'grid', placeItems: 'center', color: 'var(--bg)' }}><Icon name="check" size={16} style={{ fontWeight: 600 }} /></span>Email me new chapters
            </label>
          </div>

          <div className="panel stack" style={{ gap: 20, padding: 28 }}>
            <Label>Badges</Label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className="badge new">NEW</span><span className="chip" style={{ fontSize: 12, padding: '4px 10px', color: 'var(--ink-2)' }}>Fantasy</span>
              <span className="badge success">ONGOING</span><span className="badge info">COMPLETED</span><span className="badge warning">HIATUS</span>
              <span className="badge neutral" style={{ color: 'var(--ink-1)' }}><Icon name="lock" size={13} />PREMIUM</span><span className="badge" style={{ background: 'rgba(0,0,0,.6)' }}>HD</span>
            </div>
            <Label>Tabs · click</Label>
            <div role="tablist" className="tabs" style={{ gap: 24 }}>
              {['Chapters', 'About', 'Community'].map((t, i) => <button key={t} type="button" role="tab" aria-selected={tab === i} style={{ paddingBottom: 12 }} onClick={() => setTab(i)}>{t}</button>)}
            </div>
            <Segmented stretch h={36} options={[[0, 'Chapters'], [1, 'About'], [2, 'Community']]} value={tab} onChange={setTab} />
            <Label>Tooltip</Label>
            <div className="row" style={{ gap: 14 }}>
              <IconButton icon="fullscreen" label="Fullscreen" h={40} variant="boxed" />
              <div role="tooltip" className="row" style={{ padding: '7px 10px', borderRadius: 8, background: 'var(--ink-1)', color: 'var(--bg)', font: '500 13px var(--sans)', gap: 8 }}>
                Fullscreen <span style={{ font: '500 11px var(--mono)', padding: '1px 5px', borderRadius: 4, background: 'rgba(0,0,0,.1)' }}>F</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="content" n="05" kicker="CARDS & CHAPTERS" title="The artwork does the work" intro="Covers are 3:4, radius 14, no frames. Text sits below, never over art, except in the hero. Striped blocks mark where real cover art goes.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '24px 16px' }}>
          <div className="stack" style={{ gap: 10 }}>
            <Cover bg={cover(40)} tag="COVER ART" />
            <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px/1.3 var(--sans)' }}>The Lantern Keeper</span><span className="meta">CH. 112 · FANTASY</span></div>
            <Note>DEFAULT</Note>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <Cover bg={cover(220)} style={{ transform: 'translateY(-4px)', boxShadow: '0 20px 40px -16px rgba(0,0,0,.9)', outline: '1px solid rgba(255,255,255,.18)' }}>
              <div style={{ position: 'absolute', right: 8, top: 8, width: 32, height: 32, borderRadius: 999, background: 'rgba(11,11,13,.7)', display: 'grid', placeItems: 'center', zIndex: 1 }}><Icon name="bookmark" size={18} /></div>
            </Cover>
            <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px/1.3 var(--sans)' }}>Glass Tide</span><span className="meta">CH. 48 · ROMANCE</span></div>
            <Note>HOVER · lift 4, quick bookmark</Note>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <Cover bg={cover(150)}><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,.15)', zIndex: 1 }}><div style={{ width: '64%', height: '100%', background: 'var(--ember)' }} /></div></Cover>
            <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px/1.3 var(--sans)' }}>Iron Orchard</span><span className="meta">CH. 31 OF 48</span></div>
            <Note>IN PROGRESS</Note>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 14 }} />
            <div style={{ height: 14, width: '80%', borderRadius: 4, background: 'var(--s2)' }} /><div style={{ height: 10, width: '50%', borderRadius: 4, background: 'var(--s2)' }} />
            <Note>LOADING</Note>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="stack" style={{ aspectRatio: '3/4', borderRadius: 14, background: 'var(--s1)', border: '1px dashed rgba(255,255,255,.14)', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ink-3)', textAlign: 'center', padding: 16 }}>
              <Icon name="broken_image" size={28} /><span style={{ font: '500 13px var(--sans)' }}>Cover unavailable</span><Button variant="outline" h={28} px={10} fs={12}>Retry</Button>
            </div>
            <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px/1.3 var(--sans)' }}>Moonlit Ledger</span><span className="meta">CH. 9</span></div>
            <Note>IMAGE ERROR</Note>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20 }}>
          <div className="panel stack" style={{ gap: 12, padding: 20 }}>
            <Label>Continue card</Label>
            <div className="row" style={{ gap: 14, padding: 12, borderRadius: 14, background: 'var(--s2)' }}>
              <Cover bg={cover(300)} width={64} radius={10} />
              <div className="stack grow" style={{ gap: 6 }}><span style={{ font: '600 15px var(--sans)' }}>Ninth Gate Academy</span><span className="meta">CH. 77 · PAGE 18 / 52</span><Bar pct={35} /></div>
              <IconButton icon="play_arrow" fill label="Resume" h={40} variant="solid" />
            </div>
            <span style={{ font: '600 14px var(--sans)', color: 'var(--ink-2)', marginTop: 8 }}>Ranked row</span>
            <div className="row" style={{ gap: 14 }}>
              <span style={{ font: '400 44px/1 var(--serif)', color: 'var(--ember)', width: 34, textAlign: 'center' }}>1</span>
              <div style={{ width: 48, aspectRatio: '3/4', borderRadius: 8, background: cover(40) }} />
              <div className="stack" style={{ gap: 4 }}><span style={{ font: '600 15px var(--sans)' }}>The Lantern Keeper</span><span className="meta">★ 4.9 · 1.2M READS</span></div>
            </div>
          </div>
          <div className="panel stack" style={{ padding: '8px 20px 20px' }}>
            <span style={{ font: '600 14px var(--sans)', color: 'var(--ink-2)', padding: '12px 0' }}>Chapter list items</span>
            <div className="row" style={{ gap: 14, padding: '14px 12px', margin: '0 -12px', borderRadius: 12, background: 'rgba(232,130,95,.08)' }}>
              <span style={{ font: '500 13px var(--mono)', color: 'var(--ember)', width: 40 }}>112</span>
              <div className="stack grow" style={{ gap: 3 }}><span style={{ font: '600 15px var(--sans)' }}>The Last Flame</span><span className="meta">2H AGO</span></div><span className="badge new">NEW</span>
            </div>
            {([
              ['111', 'Wick and Wax', <div key="r" className="row" style={{ gap: 8 }}><span className="meta">READING · 40%</span><div style={{ width: 60 }}><Bar pct={40} /></div></div>, <Icon key="i" name="chevron_right" color="var(--ink-3)" />, false],
              ['110', 'The Glass Street', <span key="r" className="meta" style={{ color: 'var(--ink-4)' }}>READ · 3 DAYS AGO</span>, <Icon key="i" name="check_circle" size={18} color="var(--success)" />, true],
              ['113', 'Early access', <span key="r" className="meta">FREE IN 6 DAYS</span>, <Icon key="i" name="lock" size={18} color="var(--ink-2)" />, false],
            ] as [string, string, ReactNode, ReactNode, boolean][]).map(([n, t, meta, end, read]) => (
              <div key={n} className="row" style={{ gap: 14, padding: '14px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ font: '500 13px var(--mono)', color: read ? 'var(--ink-4)' : 'var(--ink-2)', width: 40 }}>{n}</span>
                <div className="stack grow" style={{ gap: 3 }}><span style={{ font: `${read ? 500 : 600} 15px var(--sans)`, color: read ? 'var(--ink-3)' : undefined }}>{t}</span>{meta}</div>{end}
              </div>
            ))}
            <div className="row" style={{ gap: 14, padding: '14px 0', borderTop: '1px solid rgba(255,255,255,.06)' }}>
              <div style={{ width: 40, height: 12, borderRadius: 4, background: 'var(--s2)' }} />
              <div className="stack grow" style={{ gap: 6 }}><div className="skeleton" style={{ width: '60%', height: 12, borderRadius: 4 }} /><div style={{ width: '30%', height: 9, borderRadius: 4, background: 'var(--s2)' }} /></div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="feedback" n="06" kicker="FEEDBACK" title="Modals, toasts, progress, empty & error">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 20 }}>
          <div className="panel stack" style={{ gap: 16, padding: 28, alignItems: 'flex-start' }}>
            <Label>Dialog · live</Label>
            <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>Scrim fades 200ms, panel rises 8px over 240ms. Focus is trapped; Esc closes.</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button h={40} fs={14} onClick={() => setModal(true)}>Open dialog</Button>
              <Button h={40} fs={14} onClick={() => push('Added to your library')}>Show toast</Button>
            </div>
            <div className="stack" style={{ width: '100%', padding: 24, borderRadius: 20, background: 'var(--s3)', border: '1px solid rgba(255,255,255,.1)', boxShadow: 'var(--e2)', gap: 12 }}>
              <span style={{ font: '400 24px var(--serif)' }}>Remove bookmark?</span>
              <span style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--ink-2)' }}>Glass Tide will leave your library. Reading progress is kept.</span>
              <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}><Button variant="ghost" h={40} fs={14}>Cancel</Button><Button variant="primary" h={40} fs={14}>Remove</Button></div>
            </div>
          </div>
          <div className="panel stack" style={{ gap: 14, padding: 28 }}>
            <Label>Toasts</Label>
            <div className="toast" style={{ animation: 'none' }}><Icon name="check_circle" fill color="var(--success)" /><span className="grow">Added to your library</span><span style={{ color: 'var(--ember)', font: '600 13px var(--sans)' }}>Undo</span></div>
            <div className="toast" style={{ animation: 'none', boxShadow: 'none' }}><Icon name="content_copy" color="var(--info)" /><span className="grow">Account number copied</span></div>
            <div className="toast" style={{ animation: 'none', boxShadow: 'none', borderColor: 'rgba(229,103,92,.3)' }}><Icon name="wifi_off" color="var(--danger)" /><span className="grow">Connection lost. Progress saved locally.</span></div>
            <span style={{ font: '600 14px var(--sans)', color: 'var(--ink-2)', marginTop: 10 }}>Progress</span>
            <div className="stack" style={{ gap: 6 }}><div className="row meta" style={{ justifyContent: 'space-between' }}><span>UPLOADING · ch-112.zip</span><span>68%</span></div><Bar h={4} pct={68} color="var(--ink-1)" /></div>
            <div className="row" style={{ gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'conic-gradient(#E8825F 0 72%,#2A2A30 72% 100%)', display: 'grid', placeItems: 'center' }}><div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--s1)', display: 'grid', placeItems: 'center', font: '500 11px var(--mono)' }}>72</div></div>
              <span className="spinner" style={{ width: 22, height: 22 }} />
              <div className="row grow" style={{ gap: 4 }}>{['var(--success)', 'var(--success)', 'var(--ember)', 'var(--s4)', 'var(--s4)'].map((c, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: c }} />)}</div>
            </div>
          </div>
          <div className="panel stack" style={{ gap: 20, padding: 28 }}>
            <Label>Empty state</Label>
            <div className="empty" style={{ padding: '28px 16px', borderRadius: 16 }}>
              <Icon name="bookmarks" /><span style={{ font: '400 22px var(--serif)' }}>No bookmarks yet</span>
              <span style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 260, lineHeight: 1.5 }}>Tap the bookmark on any series to keep it here.</span>
              <Button variant="primary" h={40} fs={14} style={{ marginTop: 6 }}>Browse trending</Button>
            </div>
            <Label>Error state</Label>
            <div className="row" style={{ gap: 14, padding: 16, borderRadius: 16, background: 'rgba(229,103,92,.08)', border: '1px solid rgba(229,103,92,.25)', alignItems: 'flex-start' }}>
              <Icon name="error" color="var(--danger)" />
              <div className="stack grow" style={{ gap: 6 }}>
                <span style={{ font: '600 15px var(--sans)' }}>Couldn’t load chapters</span><span style={{ fontSize: 14, color: 'var(--ink-2)' }}>Check your connection and try again.</span>
                <div><Button h={34} px={12} fs={13} icon="refresh" style={{ marginTop: 4 }}>Retry</Button></div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="reader" n="07" kicker="READER CONTROLS" title="Chrome that steps aside" intro={<>Controls float over a #050506 field, hide on scroll-down, return on tap or scroll-up. Every control is 44px minimum. <Link href="/read/lantern/112" className="ds-link">Open the live reader</Link>.</>}>
        <div className="stack" style={{ borderRadius: 24, background: 'var(--bg-reader)', border: '1px solid var(--line-1)', padding: 24, alignItems: 'center', gap: 20, overflow: 'hidden' }}>
          <div className="reader-bar row" style={{ maxWidth: 760, height: 56, borderRadius: 16, gap: 8, padding: '0 8px', boxShadow: 'none' }}>
            <IconButton icon="arrow_back" label="Back" h={40} />
            <div className="stack grow"><span className="ellipsis" style={{ font: '600 14px var(--sans)' }}>The Lantern Keeper</span><span style={{ font: '400 11px var(--mono)', color: 'var(--ink-3)' }}>CH. 112 · THE LAST FLAME</span></div>
            <span style={{ font: '600 10px var(--mono)', padding: '4px 7px', borderRadius: 6, border: '1px solid rgba(123,201,160,.35)', color: 'var(--success-text)' }}>HD · 1600W</span>
            <IconButton icon="tune" label="Settings" h={40} />
          </div>
          <div className="stripes" style={{ position: 'relative', width: 'min(420px,100%)', aspectRatio: '3/2', borderRadius: 4, background: 'linear-gradient(170deg,oklch(.3 .05 40),oklch(.16 .03 30))' }}>
            <span style={{ position: 'absolute', left: 12, top: 12, font: '400 10px var(--mono)', color: 'rgba(255,255,255,.5)' }}>PANEL ARTWORK</span>
          </div>
          <div className="reader-bar row" style={{ maxWidth: 560, height: 60, borderRadius: 999, gap: 6, padding: '0 8px', boxShadow: 'var(--e2)' }}>
            <IconButton icon="skip_previous" label="Previous chapter" variant="round" />
            <div className="stack grow" style={{ gap: 6, padding: '0 6px' }}>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--s4)', position: 'relative' }}>
                <div style={{ width: '42%', height: '100%', borderRadius: 2, background: 'var(--ember)' }} />
                <div style={{ position: 'absolute', left: '42%', top: '50%', width: 14, height: 14, margin: '-7px 0 0 -7px', borderRadius: '50%', background: 'var(--ink-1)' }} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between', font: '400 10px var(--mono)', color: 'var(--ink-3)' }}><span>PAGE 27 / 64</span><span>~6 MIN LEFT</span></div>
            </div>
            <IconButton icon="format_list_bulleted" label="Chapters" variant="round" />
            <IconButton icon="skip_next" label="Next chapter" variant="solid" />
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'center', font: '400 12px var(--mono)', color: 'var(--ink-3)' }}>
            {[['← →', 'chapter'], ['J K', 'scroll'], ['F', 'fullscreen'], ['S', 'settings'], ['H', 'hide UI'], ['?', 'shortcuts']].map(([k, l]) => (
              <span key={k} className="row" style={{ gap: 6 }}><span className="kbd" style={{ color: 'var(--ink-1)', fontSize: 12 }}>{k}</span>{l}</span>
            ))}
          </div>
        </div>
      </Section>

      <Section id="admin" n="08" kicker="ADMIN COMPONENTS" title="Denser, same family" intro="Admin uses 14px body, 36px controls and tabular mono numerals. Pipeline stage colors: done = success, active = ember, failed = danger, waiting = ink-3.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
          <div className="card stack" style={{ padding: 18, gap: 10, borderRadius: 14 }}><span style={{ font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>Active users · 24h</span><span style={{ font: '500 30px/1 var(--mono)', letterSpacing: '-.02em' }}>18,402</span><span style={{ font: '500 12px var(--mono)', color: 'var(--success-text)' }}>↑ 6.2% vs last week</span></div>
          <div className="card stack" style={{ padding: 18, gap: 10, borderRadius: 14, borderColor: 'rgba(229,103,92,.25)' }}><span style={{ font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>Failed jobs</span><span style={{ font: '500 30px/1 var(--mono)', color: 'var(--danger-text)' }}>3</span><span style={{ font: '500 12px var(--sans)', color: 'var(--ink-2)' }}>2 OCR timeouts · 1 corrupt ZIP</span></div>
          <div className="card stack" style={{ padding: 18, gap: 12, borderRadius: 14 }}>
            <span style={{ font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>Confidence</span>
            {[[94, 'var(--success)', undefined], [61, 'var(--warning)', 'var(--warning-text)']].map(([p, c, t]) => (
              <div key={p as number} className="row" style={{ gap: 10 }}><div className="grow"><Bar h={6} pct={p as number} color={c as string} /></div><span style={{ font: '500 13px var(--mono)', color: t as string | undefined }}>{((p as number) / 100).toFixed(2)}</span></div>
            ))}
          </div>
        </div>
        <div className="card stack" style={{ padding: 20, gap: 14, borderRadius: 14 }}>
          <span style={{ font: '500 12px var(--sans)', color: 'var(--ink-3)' }}>Pipeline stepper</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,minmax(0,1fr))', gap: 6 }}>
            {STAGES.map((s, i) => (
              <div key={s} className="stack" style={{ gap: 6, minWidth: 0 }}>
                <div style={{ height: 4, borderRadius: 2, background: i < 3 ? 'var(--success)' : i === 3 ? 'linear-gradient(90deg,#E8825F 55%,#2A2A30 55%)' : 'var(--s4)' }} />
                <span className="ellipsis" style={{ font: '500 10px var(--mono)', color: i < 3 ? 'var(--success-text)' : i === 3 ? 'var(--ember)' : 'var(--ink-4)' }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12 }}>
          <div className="stack" style={{ padding: 32, borderRadius: 14, border: '1.5px dashed rgba(255,255,255,.18)', background: 'var(--s1)', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <Icon name="folder_zip" size={30} color="var(--ink-2)" /><span style={{ font: '600 15px var(--sans)' }}>Drop chapter ZIP</span><span style={{ fontSize: 13, color: 'var(--ink-3)' }}>JPG/PNG/WEBP pages, max 500 MB</span>
          </div>
          <div className="stack" style={{ padding: 32, borderRadius: 14, border: '1.5px dashed var(--ember)', background: 'rgba(232,130,95,.06)', alignItems: 'center', gap: 10, textAlign: 'center' }}>
            <Icon name="download" size={30} color="var(--ember)" /><span style={{ font: '600 15px var(--sans)' }}>Release to upload</span><span style={{ fontSize: 13, color: 'var(--ink-2)' }}>DRAG-OVER STATE</span>
          </div>
        </div>
      </Section>

      <Section id="motion" n="09" kicker="MOTION" title="Short, eased, purposeful">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
          {MOTION.map(([h, d]) => (
            <div key={h} className="card stack" style={{ padding: 18, gap: 6, borderRadius: 14 }}><span style={{ font: '500 13px var(--mono)', color: 'var(--ember)' }}>{h}</span><span style={{ fontSize: 14, color: 'var(--ink-2)' }}>{d}</span></div>
          ))}
        </div>
      </Section>

      {modal && (
        <div className="scrim" style={{ background: 'rgba(5,5,6,.72)', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setModal(false)}>
          <div role="dialog" aria-modal="true" aria-label="Remove bookmark?" className="stack" onClick={e => e.stopPropagation()} style={{ width: 'min(440px,100%)', padding: 28, borderRadius: 20, background: 'var(--s3)', border: '1px solid rgba(255,255,255,.1)', boxShadow: 'var(--e2)', gap: 12, animation: 'pop .24s var(--ease)' }}>
            <span style={{ font: '400 26px var(--serif)' }}>Remove bookmark?</span>
            <span style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--ink-2)' }}>Glass Tide will leave your library. Reading progress is kept.</span>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
              <Button variant="ghost" autoFocus onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>Remove</Button>
            </div>
          </div>
        </div>
      )}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </div>
  );
}
