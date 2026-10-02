import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Hanken_Grotesk, Newsreader, Noto_Sans_KR } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({ subsets: ['latin'], weight: 'variable', style: ['normal', 'italic'], axes: ['opsz'], variable: '--font-newsreader' });
const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-hanken' });
const geistMono = Geist_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-geist-mono' });
const notoKr = Noto_Sans_KR({ weight: ['500'], preload: false, variable: '--font-noto-kr' });

export const metadata: Metadata = {
  title: { default: 'Nerio', template: '%s · Nerio' },
  description: 'Translated manhwa, carefully typeset, published chapter by chapter.',
};

export const viewport: Viewport = { themeColor: '#0B0B0D', colorScheme: 'dark' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${newsreader.variable} ${hanken.variable} ${geistMono.variable} ${notoKr.variable}`}>
      <head>
        {/* Icon font: next/font can't subset ligature icon fonts, so it loads from Google Fonts directly. */}
        {/* display=block avoids flashing ligature names like "bookmark" before the font loads. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,300,0..1,0&display=block" />
      </head>
      <body>{children}</body>
    </html>
  );
}
