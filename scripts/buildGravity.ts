// 2026-11-26 (the user: "co gdyby policzyć to np on offami z pbp" — gravity): how much better a player's
// teammates shoot with him on the floor than the team shoots with him off, in the same season.
//
// From pbpstats team on/off totals (scripts/fetchPbpOnOff.sh: Points, FGA, FTA per team and season, each
// player on / off) and the player's own season totals (raw/pbpstats *-Player.json, same team only):
//   teammates' TS with him on  = (team points on - his points) / 2(team TSA on - his TSA)
//   team TS with him off       =  team points off / 2 team TSA off
// Raw lift = the difference. A starter's off-minutes are bench minutes, so the raw lift grows with his
// share of the minutes; that part (a least-squares line on the on-share) is taken out, the rest is his.
// Per season, then src/data/gravity.json: normalized name -> end year -> [lift (TS fraction), minutes on].
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizePlayerName } from '../src/data/schema';

const RAW = resolve(import.meta.dirname, '../src/data/raw');
const DIR = resolve(RAW, 'pbpOnOff');
type OnOff = { Name: string; On: string; Off: string; MinutesOn: number; MinutesOff: number };
const read = (f: string): OnOff[] => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).results ?? []) : []);
const MIN_ON = 1000, MIN_OFF = 300;

type Row = { key: string; end: number; raw: number; onShare: number; minOn: number };
const rows: Row[] = [];
const files = readdirSync(DIR).filter((f) => f.endsWith('-Points.json'));
const playerTotals = new Map<string, Map<string, { pts: number; tsa: number }>>();
for (const f of files) {
  const [season, team] = [f.slice(0, 7), f.slice(8, -'-Points.json'.length)];
  if (!playerTotals.has(season)) {
    const m = new Map<string, { pts: number; tsa: number }>();
    const pf = resolve(RAW, 'pbpstats', `${season}-Player.json`);
    if (existsSync(pf)) for (const r of JSON.parse(readFileSync(pf, 'utf8')).multi_row_table_data ?? []) {
      const fga = ['AtRimFGA', 'ShortMidRangeFGA', 'LongMidRangeFGA', 'Corner3FGA', 'Arc3FGA'].reduce((s, k) => s + (Number(r[k]) || 0), 0);
      m.set(`${String(r.TeamId)}|${normalizePlayerName(String(r.Name))}`, { pts: Number(r.Points) || 0, tsa: fga + 0.44 * (Number(r.FTA) || 0) });
    }
    playerTotals.set(season, m);
  }
  const totals = playerTotals.get(season)!;
  const pts = read(resolve(DIR, f)), fga = read(resolve(DIR, `${season}-${team}-FGA.json`)), fta = read(resolve(DIR, `${season}-${team}-FTA.json`));
  const byName = (list: OnOff[]) => new Map(list.map((r) => [r.Name, r]));
  const F = byName(fga), T = byName(fta);
  for (const p of pts) {
    const g = F.get(p.Name), t = T.get(p.Name), own = totals.get(`${team}|${normalizePlayerName(p.Name)}`);
    if (!g || !t || !own || p.MinutesOn < MIN_ON || p.MinutesOff < MIN_OFF) continue;
    const tsaOn = Number(g.On) + 0.44 * Number(t.On) - own.tsa, tsaOff = Number(g.Off) + 0.44 * Number(t.Off);
    if (tsaOn <= 100 || tsaOff <= 100) continue;
    const matesOn = (Number(p.On) - own.pts) / (2 * tsaOn), off = Number(p.Off) / (2 * tsaOff);
    rows.push({ key: normalizePlayerName(p.Name), end: Number(season.slice(0, 4)) + 1, raw: matesOn - off, onShare: p.MinutesOn / (p.MinutesOn + p.MinutesOff), minOn: p.MinutesOn });
  }
}
// The bench part: least squares of the raw lift on the on-share, weighted by minutes on.
let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
for (const r of rows) { const w = r.minOn; sw += w; sx += w * r.onShare; sy += w * r.raw; sxx += w * r.onShare ** 2; sxy += w * r.onShare * r.raw; }
const b = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), a = (sy - b * sx) / sw;
const out: Record<string, Record<string, [number, number]>> = {};
for (const r of rows) (out[r.key] ??= {})[String(r.end)] = [Math.round((r.raw - (a + b * r.onShare)) * 10000) / 10000, r.minOn];
writeFileSync(resolve(import.meta.dirname, '../src/data/gravity.json'), JSON.stringify(out));
console.log(`player-seasons ${rows.length}, players ${Object.keys(out).length}; bench line ${a.toFixed(4)} + ${b.toFixed(4)} x on-share`);
const show = (n: string) => { const s = out[normalizePlayerName(n)]; if (s) console.log(n.padEnd(18), Object.entries(s).map(([y, [v, m]]) => `${y}:${(v * 100).toFixed(1)}(${m})`).join(' ')); };
for (const n of ['Stephen Curry', 'Steve Nash', 'LeBron James', 'Chris Paul', 'Nikola Jokic', 'Klay Thompson', 'Kyle Korver', 'Dirk Nowitzki', 'James Harden', 'Russell Westbrook']) show(n);
