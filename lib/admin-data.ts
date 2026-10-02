import type { Status } from './data';

export type AdminSeries = { id: string; title: string; author: string; hue: number; status: Status; ch: number; reads: string; when: string };

export const ADMIN_SERIES: AdminSeries[] = ([
  ['lantern', 'The Lantern Keeper', 'Han Seo-yun', 40, 'Ongoing', 114, '12.4M', '2h ago'],
  ['ninth', 'Ninth Gate Academy', 'Kim Tae-oh', 300, 'Ongoing', 77, '9.1M', '1d ago'],
  ['salt', 'Heir of the Salt Throne', 'Jang Min-ho', 80, 'Completed', 204, '22.0M', '4mo ago'],
  ['glass', 'Glass Tide', 'Park Ji-an', 220, 'Ongoing', 48, '5.8M', '5h ago'],
  ['bloom', 'Bloom After Ruin', 'Nam Yu-jin', 130, 'Ongoing', 56, '6.3M', '9h ago'],
  ['monster', 'A Quiet Kind of Monster', 'Yoon Ha-rin', 10, 'Ongoing', 63, '3.9M', '2d ago'],
  ['winters', 'Sixteen Winters', 'Seo Ga-eun', 190, 'Ongoing', 35, '2.2M', '6h ago'],
  ['crane', 'Paper Crane Protocol', 'Lim Do-hyun', 340, 'Ongoing', 21, '1.6M', '1d ago'],
  ['hollow', 'Hollow Crown Society', 'Ryu Ha-neul', 280, 'Hiatus', 90, '4.4M', '3w ago'],
  ['ledger', 'Moonlit Ledger', 'Choi Eun-seo', 260, 'Draft', 9, '410K', '3d ago'],
] as const).map(([id, title, author, hue, status, ch, reads, when]) => ({ id, title, author, hue, status, ch, reads, when }));

export const adminSeries = (id: string) => ADMIN_SERIES.find(s => s.id === id) ?? ADMIN_SERIES[0];

export const STAGES = ['VALIDATING', 'OCR', 'TRANSLATING', 'CLEANING', 'TYPESETTING', 'OPTIMIZING', 'QA', 'READY', 'PUBLISHED'];
export const STAGE_SHORT = ['VALID', 'OCR', 'TRANS', 'CLEAN', 'TYPE', 'OPTIM', 'QA', 'READY', 'PUB'];
export const STAGE_DESC = [
  'Checking archive, page order and image integrity', 'Detecting text regions on 48 pages', 'Translating 212 regions KO → EN with series glossary',
  'Removing original lettering from bubbles and SFX', 'Fitting translated text into bubbles', 'Encoding WEBP at 720 / 1200 / 1600 px',
  'Checking overflow, glossary terms and low-confidence regions', 'Waiting for publish', 'Live for readers',
];

export type ChapterStatus = 'PUBLISHED' | 'READY' | 'IN REVIEW' | 'PROCESSING' | 'FAILED';
export const CH_TONE: Record<ChapterStatus, string> = { PUBLISHED: 'success', READY: 'info', 'IN REVIEW': 'warning', PROCESSING: 'ember', FAILED: 'danger' };
export const ADMIN_CH_TITLES = ['The Unlit Quarter', 'Second Sunrise', 'Embers', 'The Last Flame', 'Wick and Wax', 'The Glass Street', 'Ash Market', 'A Debt of Daylight', 'Moth Season', 'Smoke Signals'];

export type Region = { x: string; y: string; w: string; h: string; ko: string; en: string; conf: number; kind: string; warn?: string };
export const REGIONS: Region[] = [
  { x: '8%', y: '5%', w: '40%', h: '13%', ko: '등불이 꺼지면, 이 도시는 처음으로 밤을 보게 될 거야.', en: 'If the lantern goes out, this city will see night for the first time.', conf: .94, kind: 'SPEECH' },
  { x: '54%', y: '22%', w: '38%', h: '11%', ko: '그럼 꺼뜨리면 되잖아.', en: 'Then just put it out.', conf: .97, kind: 'SPEECH' },
  { x: '10%', y: '40%', w: '30%', h: '9%', ko: '...넌 몰라.', en: '...You don’t know.', conf: .88, kind: 'SPEECH' },
  { x: '48%', y: '52%', w: '44%', h: '14%', ko: '이백 년 동안 갚지 못한 빚이 있어. 그 빚을 받으러 오는 거야.', en: 'There’s a debt unpaid for two hundred years. They’re coming to collect.', conf: .71, kind: 'SPEECH', warn: 'Glossary: “빚” is rendered “the Debt” (capitalized) elsewhere in this series.' },
  { x: '6%', y: '70%', w: '34%', h: '10%', ko: '쾅!', en: 'KRAK!', conf: .62, kind: 'SFX', warn: 'Low confidence. SFX overlaps artwork; cleaning may be incomplete.' },
  { x: '50%', y: '80%', w: '40%', h: '12%', ko: '등불지기는 도망치지 않는다.', en: 'A lantern keeper doesn’t run.', conf: .79, kind: 'NARRATION', warn: 'Text may overflow bubble at 1600px (102% fill).' },
];

export const confColors = (c: number): [string, string] =>
  c >= .85 ? ['var(--success)', 'var(--success-text)'] : c >= .7 ? ['var(--warning)', 'var(--warning-text)'] : ['var(--danger)', 'var(--danger-text)'];

export type JobStatus = 'RUNNING' | 'FAILED' | 'READY' | 'CANCELLED';
export type Job = { id: string; sid: string; ch: number; stage: number; pct: number; status: JobStatus; started: string; error?: string };
export const INITIAL_JOBS: Job[] = [
  { id: 'JOB-8821', sid: 'lantern', ch: 115, stage: 3, pct: 40, status: 'RUNNING', started: '14:02' },
  { id: 'JOB-8820', sid: 'glass', ch: 49, stage: 1, pct: 70, status: 'RUNNING', started: '13:58' },
  { id: 'JOB-8817', sid: 'monster', ch: 64, stage: 1, pct: 0, status: 'FAILED', started: '12:40', error: 'OCR_TIMEOUT · page 31 exceeded 120s (4800×14200 px). Split tall pages or retry.' },
  { id: 'JOB-8815', sid: 'crane', ch: 22, stage: 0, pct: 0, status: 'FAILED', started: '11:12', error: 'ZIP_CORRUPT · central directory missing. Re-export the archive.' },
  { id: 'JOB-8812', sid: 'bloom', ch: 57, stage: 6, pct: 20, status: 'RUNNING', started: '10:31' },
  { id: 'JOB-8809', sid: 'winters', ch: 36, stage: 7, pct: 100, status: 'READY', started: '09:05' },
];

export const QUEUE: [string, number, number, number, string, number, number][] = [
  ['lantern', 113, 48, 212, '2 H', .81, 3], ['glass', 49, 52, 188, '40 MIN', .86, 1], ['bloom', 57, 41, 160, '1 H', .9, 0], ['ninth', 78, 60, 241, '3 H', .78, 6], ['crane', 22, 38, 144, '5 H', .84, 2],
];

export const USERS: [string, string, 'PREMIUM' | 'FREE' | 'PENDING', string, string, string, number][] = [
  ['Hana Seo', 'hana@example.com', 'PREMIUM', '1,284', '2 min ago', 'Mar 2025', 40], ['Daniel Ortiz', 'dan.o@example.com', 'FREE', '402', '1 h ago', 'Jun 2025', 220],
  ['Minji Park', 'minji.p@example.com', 'PENDING', '88', '3 h ago', 'Sep 2026', 300], ['Aiko Tanaka', 'aiko@example.com', 'PREMIUM', '2,019', 'yesterday', 'Jan 2025', 150],
  ['Lucas Meyer', 'lmeyer@example.com', 'FREE', '57', '4 d ago', 'Aug 2026', 80], ['Sara Lind', 'sara.l@example.com', 'FREE', '731', '6 d ago', 'Nov 2025', 10],
];
export const PLAN_TONE = { PREMIUM: 'ember', FREE: 'neutral', PENDING: 'warning' } as const;

export const PAYMENTS: [string, string, string, string, string, string, number][] = [
  ['Minji Park', 'NER-4Q8Z1M', '2026100374410', '3 months', '€12.99', 'Today 14:32', 300], ['Tom Becker', 'NER-H2K9PX', 'SEPA-88210037', '1 month', '€4.99', 'Today 09:10', 200],
  ['Yuna Choi', 'NER-7D1W3R', '2026100205531', '12 months', '€44.99', 'Yesterday 21:47', 340], ['Aiko Tanaka', 'NER-2B6V8N', '2026092911873', '12 months', '€44.99', 'Sep 29', 150],
];

export const REPORTS: [string, string, string, string, string, string, string][] = [
  ['translate', 'var(--warning)', 'Wrong translation', 'THE LANTERN KEEPER · CH. 112 · P. 14', 'Yeon says “sister” but it’s her teacher. The original uses 선생님.', '@jinwoo.k', '1 h ago'],
  ['image_not_supported', 'var(--danger)', 'Missing page', 'GLASS TIDE · CH. 48', 'Page 23 is blank on mobile, loads fine on desktop.', '@aiko', '3 h ago'],
  ['text_fields', 'var(--info)', 'Text overflow', 'NINTH GATE ACADEMY · CH. 77 · P. 8', 'Bubble text is cut off at the bottom.', '@readerlee', '5 h ago'],
  ['blur_on', 'var(--ink-2)', 'Image quality', 'IRON ORCHARD · CH. 30', 'Blurry panels in the first half.', '@sara.l', '2 d ago'],
  ['translate', 'var(--warning)', 'Wrong translation', 'BLOOM AFTER RUIN · CH. 55 · P. 31', 'The spell name changed from “Rootcall” to “Root Summon”.', '@mireu_fan', '2 d ago'],
];
