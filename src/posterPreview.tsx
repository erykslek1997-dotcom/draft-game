import { createRoot } from 'react-dom/client';
import './index.css';
import './App.css';
import './night/index.css';
import { draftPool } from './data/draftPool';
import { ShareNight, type PosterData } from './night/Share';

/**
 * Dev-only (2026-10-29: a share-card screenshot took a full draft and season — "porażka że to tyle
 * zajmuje"): the season's share window with a fixed sample team, served by `vite` at
 * /poster-preview.html. Not part of the build. `?bench=N` sets the bench size (0-4).
 */
const find = (name: string, years: string) => draftPool.find((p) => p.playerName === name && p.spanLabel === years)!;
const five = [
  ['James Harden', '2018-20', 32.7, 36], ['Dan Majerle', '1992-94', 17.1, 36], ['Paul Pierce', '2001-03', 21.4, 39], ['Robert Horry', '1996-98', 9.8, 33], ["Shaquille O'Neal", '2000-02', 24.9, 34],
] as const;
const bench = [['Michael Cooper', '1981-83', 7.8, 24], ['Nicolas Batum', '2012-14', 4.3, 23], ['Clint Capela', '2017-19', 6.5, 14], ['George Hill', '2013-15', 5.1, 12]] as const;
const n = Number(new URLSearchParams(location.search).get('bench') ?? 3);
const p = (rows: readonly (readonly [string, string, number, number])[]) => rows.map(([name, y, pts, min]) => ({ span: find(name, y), num: pts, min })).filter((x) => x.span);
const d: PosterData = {
  mode: 'All-Time Draft · season',
  date: new Date('2026-10-29'),
  kick: 'Out in the semifinals, 1–4 to Gators',
  head: 'Little Rock Boulders',
  line: '53–29 · 3rd seed · 5–7 in the playoffs',
  five: p(five),
  bench: p(bench.slice(0, n)),
  unit: 'ppg',
  prof: [
    { label: 'Talent', value: 80 },
    { label: 'Offense', value: 87, tone: 'hi' },
    { label: 'Defense', value: 75, tone: 'lo' },
    { label: 'Spacing', value: 83 },
    { label: 'Fit', value: 78 },
  ],
  ig: true,
  draft: ['The draft · 2nd of 16', 'Rating 86 · best 86'],
  strip: [['Season', '53–29'], ['Seed', '3rd'], ['Playoffs', '5–7'], ['Result', 'Semifinals']],
  foot: 'All-NBA 1st Harden · All-NBA 3rd O’Neal',
};
createRoot(document.getElementById('root')!).render(
  <div className="nt">
    <ShareNight d={d} fileName="preview" onClose={() => {}} />
  </div>,
);
