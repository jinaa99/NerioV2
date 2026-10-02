export type Status = 'Ongoing' | 'Completed' | 'Hiatus' | 'Draft';

export type Series = {
  id: string;
  title: string;
  alt: string;
  hue: number;
  genres: string[];
  status: Status;
  rating: number;
  votes: string;
  ch: number;
  early: number;
  author: string;
  artist: string;
  reads: string;
  followers: string;
  comments: string;
  rank: number;
  when: string;
  fresh: boolean;
  progress: number;
  since: string;
  desc: string;
};

export const SERIES: Series[] = [
  { id: 'lantern', title: 'The Lantern Keeper', alt: '등불지기 · Deungbul Jigi', hue: 40, genres: ['Fantasy', 'Drama', 'Mystery'], status: 'Ongoing', rating: 4.9, votes: '86.2K', ch: 114, early: 2, author: 'Han Seo-yun', artist: 'Studio Mireu', reads: '12.4M', followers: '384K', comments: '52.1K', rank: 1, when: '2h ago', fresh: true, progress: 111, since: '', desc: 'In Hwaseong, the night was abolished two hundred years ago. When disgraced lamplighter Yeon inherits the last real flame, she learns the city’s endless daylight is a debt someone is still paying, and the lantern in her hands is how it gets collected.' },
  { id: 'glass', title: 'Glass Tide', alt: '유리 물결 · Yuri Mulgyeol', hue: 220, genres: ['Romance', 'Drama'], status: 'Ongoing', rating: 4.7, votes: '41.0K', ch: 48, early: 2, author: 'Park Ji-an', artist: 'Lee Dae-ho', reads: '5.8M', followers: '201K', comments: '18.4K', rank: 3, when: '5h ago', fresh: true, progress: 22, since: '', desc: 'A glassblower and a lighthouse heir trade letters across a strait that freezes once a decade. This is the winter it does.' },
  { id: 'ninth', title: 'Ninth Gate Academy', alt: '제9문 학원', hue: 300, genres: ['Action', 'School', 'Fantasy'], status: 'Ongoing', rating: 4.8, votes: '73.5K', ch: 77, early: 2, author: 'Kim Tae-oh', artist: 'Kim Tae-oh', reads: '9.1M', followers: '312K', comments: '40.2K', rank: 2, when: '1d ago', fresh: false, progress: 77, since: '', desc: 'Eight gates admit the gifted. The ninth admits whoever survives it. Jun is the first in forty years to walk out.' },
  { id: 'monster', title: 'A Quiet Kind of Monster', alt: '조용한 괴물', hue: 10, genres: ['Thriller', 'Horror'], status: 'Ongoing', rating: 4.6, votes: '22.8K', ch: 63, early: 2, author: 'Yoon Ha-rin', artist: 'Bae Soo', reads: '3.9M', followers: '144K', comments: '11.0K', rank: 6, when: '2d ago', fresh: false, progress: 0, since: '', desc: 'Every apartment in Block 4 hears the same knocking at 3:12 a.m. Only one tenant knocks back.' },
  { id: 'ledger', title: 'Moonlit Ledger', alt: '달빛 장부', hue: 260, genres: ['Historical', 'Romance'], status: 'Ongoing', rating: 4.5, votes: '3.1K', ch: 9, early: 0, author: 'Choi Eun-seo', artist: 'Studio Haneul', reads: '410K', followers: '28K', comments: '1.9K', rank: 14, when: '3d ago', fresh: false, progress: 0, since: '6 DAYS', desc: 'A Joseon court accountant finds a second set of books, and a name in them that should not exist.' },
  { id: 'salt', title: 'Heir of the Salt Throne', alt: '소금 왕좌의 후계자', hue: 80, genres: ['Fantasy', 'Action'], status: 'Completed', rating: 4.8, votes: '120K', ch: 204, early: 0, author: 'Jang Min-ho', artist: 'Redwood Studio', reads: '22.0M', followers: '590K', comments: '98.3K', rank: 4, when: '4mo ago', fresh: false, progress: 0, since: '', desc: 'The salt flats crown a new ruler every hundred years. This time they chose a fisherman’s daughter who cannot swim.' },
  { id: 'winters', title: 'Sixteen Winters', alt: '열여섯 번의 겨울', hue: 190, genres: ['Slice of life', 'Drama'], status: 'Ongoing', rating: 4.7, votes: '19.6K', ch: 35, early: 2, author: 'Seo Ga-eun', artist: 'Seo Ga-eun', reads: '2.2M', followers: '96K', comments: '7.7K', rank: 8, when: '6h ago', fresh: true, progress: 0, since: '2 MONTHS', desc: 'Two friends, one mountain town, and the sixteen winters between the first snowfall they shared and the last.' },
  { id: 'crane', title: 'Paper Crane Protocol', alt: '종이학 프로토콜', hue: 340, genres: ['Sci-fi', 'Thriller'], status: 'Ongoing', rating: 4.6, votes: '12.2K', ch: 21, early: 2, author: 'Lim Do-hyun', artist: 'Ahn Seol', reads: '1.6M', followers: '71K', comments: '5.0K', rank: 9, when: '1d ago', fresh: false, progress: 0, since: '3 WEEKS', desc: 'An origami artist is recruited to fold the encryption keys of a city-sized AI. One wrong crease and the city forgets her.' },
  { id: 'bloom', title: 'Bloom After Ruin', alt: '폐허 뒤의 꽃', hue: 130, genres: ['Fantasy', 'Romance'], status: 'Ongoing', rating: 4.8, votes: '38.9K', ch: 56, early: 2, author: 'Nam Yu-jin', artist: 'Studio Dalbit', reads: '6.3M', followers: '233K', comments: '21.6K', rank: 5, when: '9h ago', fresh: false, progress: 0, since: '', desc: 'After the war, a botanist-mage is sent to regrow a kingdom’s forests, and finds its last prince sleeping under one.' },
  { id: 'orchard', title: 'Iron Orchard', alt: '철의 과수원', hue: 150, genres: ['Action', 'Post-apocalyptic'], status: 'Ongoing', rating: 4.5, votes: '15.3K', ch: 48, early: 2, author: 'Go Hyun-woo', artist: 'Go Hyun-woo', reads: '2.8M', followers: '88K', comments: '6.2K', rank: 11, when: '2d ago', fresh: false, progress: 31, since: '', desc: 'In the last orchard on Earth, the trees grow steel. Harvest season is war season.' },
  { id: 'courier', title: 'The Last Courier', alt: '마지막 배달부', hue: 25, genres: ['Adventure', 'Comedy'], status: 'Ongoing', rating: 4.4, votes: '2.4K', ch: 12, early: 0, author: 'Oh Se-ri', artist: 'Kang Min', reads: '320K', followers: '19K', comments: '1.1K', rank: 16, when: '4d ago', fresh: false, progress: 0, since: '12 DAYS', desc: 'Every road in the empire has closed but one, and one stubborn courier still has a package to deliver.' },
  { id: 'hollow', title: 'Hollow Crown Society', alt: '빈 왕관 협회', hue: 280, genres: ['Mystery', 'Supernatural'], status: 'Hiatus', rating: 4.6, votes: '29.0K', ch: 90, early: 0, author: 'Ryu Ha-neul', artist: 'Studio Mireu', reads: '4.4M', followers: '160K', comments: '15.8K', rank: 7, when: '3w ago', fresh: false, progress: 0, since: '', desc: 'A secret society of dethroned heirs meets once a year. This year, someone has come to collect their crowns.' },
];

export const GENRES: [string, number, number][] = [['Fantasy', 214, 40], ['Romance', 188, 350], ['Action', 162, 25], ['Drama', 141, 260], ['Comedy', 93, 85], ['Thriller', 76, 10], ['Slice of life', 64, 190], ['Historical', 58, 60], ['Mystery', 52, 280], ['School', 45, 220], ['Sci-fi', 39, 200], ['Horror', 27, 0]];

export const TITLES = ['The Last Flame', 'Wick and Wax', 'The Glass Street', 'Ash Market', 'A Debt of Daylight', 'The Lamplighters’ Guild', 'Under the Bell Tower', 'Moth Season', 'Smoke Signals', 'What the River Kept', 'The Unlit Quarter', 'Embers', 'Cold Iron', 'A Name in Soot', 'The Night Ledger', 'Second Sunrise'];

export const PAGE_RATIOS = ['800/1180', '800/1420', '800/960', '800/1300', '800/1600', '800/1040', '800/1250', '800/1500', '800/1100', '800/1360', '800/980', '800/1440'];
export const PAGES = 12;

export const cover = (h: number) => `linear-gradient(160deg, oklch(.44 .075 ${h}), oklch(.2 .04 ${h}))`;
export const backdrop = (h: number) => `linear-gradient(120deg, oklch(.36 .07 ${h}) 0%, oklch(.22 .05 ${h + 20}) 55%, oklch(.14 .02 ${h + 40}) 100%)`;
export const tone = (h: number) => `oklch(.4 .06 ${h})`;

export const chapterTitle = (n: number) => TITLES[(n * 7) % TITLES.length];
export const getSeries = (id: string) => SERIES.find(s => s.id === id);
export const freeLatest = (s: Series) => s.ch - s.early;

export const STATUS_TONE: Record<Status, string> = { Ongoing: 'success', Completed: 'info', Hiatus: 'warning', Draft: 'neutral' };

export const PLANS = [
  { name: '1 month', sub: '30 days of Premium', price: '€4.99', save: '', until: 'Nov 3, 2026' },
  { name: '3 months', sub: '90 days of Premium', price: '€12.99', save: 'SAVE 13%', until: 'Jan 3, 2027' },
  { name: '12 months', sub: '365 days of Premium', price: '€44.99', save: 'SAVE 25%', until: 'Oct 3, 2027' },
];

export const BANK = {
  holder: 'Nerio Media Ltd.',
  bank: 'Northbank AG · Berlin',
  iban: 'DE89 3704 0044 0532 0130 00',
  bic: 'NRBKDEFFXXX',
  code: 'NER-7F3K2Q',
};

/** Demo reading progress: [seriesId, chapter, percent, time left]. */
export const CONTINUE: [string, number, number, string][] = [['lantern', 111, 40, '6 MIN LEFT'], ['ninth', 77, 35, '9 MIN LEFT'], ['orchard', 31, 64, '4 MIN LEFT'], ['glass', 22, 80, '2 MIN LEFT']];
