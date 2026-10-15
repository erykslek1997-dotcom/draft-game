/**
 * Writes src/data/teammateLift.json — for every draft-pool span, how much better his teammates shot
 * beside him, and how much his own real teammates lifted him:
 *   [lift, real teammates' lift], TS points x1000 (0.010 = one point of true shooting); spans with
 *   neither are left out.
 *
 * 2026-10-15, the user ("sprawdzić na przykładzie Curry'ego, Nasha i LeBrona, jak wpływają na
 * efficiency zawodników obok"). Measured on real seasons since 1984-85: every teammate who played a
 * season beside him (he played 1500+ minutes for that team; the teammate one team all season, 900+
 * minutes, 250+ shots, 50+ games), his true shooting against the league that season beside him
 * against his own seasons up to three years before and after on a team without him. Taken out:
 * the age curve (from every player's consecutive seasons) and the role (-0.1 TS per point of usage,
 * the same data: next to a star his teammates have the ball less). Weighted by shots; 0 = the league.
 * Magic +2.2, Nash +1.9, Jokic +1.8, Stockton +1.6, Curry +1.3, Shaq +1.1, Kidd +1.0, LeBron +0.5,
 * Paul 0, Conley -0.2, Jordan -1.1.
 *
 * The real spread between players is small (~0.5 point) next to one measurement's noise (~0.7), so
 * each lift is taken halfway between what was measured and what that noise lets one trust (the
 * user: "pośrodku"): Nash +1.4, Jokic +1.2, Curry +0.9, LeBron +0.4, Jordan -0.7. Players not
 * measured (before 1984-85, or fewer than five teammates) get 0.
 *
 * The second number is what his own real teammates lifted him by: their lifts, each by the share of
 * the game he was on the floor (his minutes over the team's, x5), over his span's seasons. His real
 * percentages already hold it, so the game pays him only the difference (`liveGame.ts`).
 *
 * Source: the user's export of the Kaggle "Historical NBA Data and Player Box Scores" per player
 * and season and per player, team and season (`src/data/raw/`), with `leagueAverages.csv` and
 * `players_bio.csv`.
 *
 * Run: npx tsx scripts/buildTeammateLift.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { draftPool } from '../src/data/draftPool';
import { spanEndYears } from '../src/engine/era';

const FROM = 1985;
const STAR_MINUTES = 1500;
const MATE_MINUTES = 900;
const MATE_SHOTS = 250;
const MATE_GAMES = 50;
const WINDOW = 3;
const MIN_MATES = 5;

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}
function readCsv(file: string): Record<string, string>[] {
  const lines = readFileSync(resolve(import.meta.dirname, '../src/data/raw', file), 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const c = parseCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, (c[i] ?? '').trim()]));
  });
}

const league = new Map<number, { ts: number; possPerMin: number }>();
for (const r of readCsv('leagueAverages.csv')) {
  if (!r.ts_pct || !r.mp_per_g) continue;
  const poss = Number(r.fga_per_g) + 0.44 * Number(r.fta_per_g) + Number(r.tov_per_g);
  league.set(Number(r.season.slice(0, 4)) + 1, { ts: Number(r.ts_pct), possPerMin: poss / Number(r.mp_per_g) });
}
const born = new Map<string, Date>();
for (const r of readCsv('players_bio.csv')) if (r.birthDate) born.set(r.personId, new Date(r.birthDate));

type Line = { games: number; minutes: number; pts: number; fga: number; fta: number; tov: number };
const stats = new Map<string, Line>();
const nameOf = new Map<string, string>();
for (const r of readCsv('playerSeasonStats.csv')) {
  nameOf.set(r.personId, r.name);
  stats.set(`${r.personId}|${r.seasonEnd}`, {
    games: Number(r.games) || 0,
    minutes: Number(r.numMinutes) || 0,
    pts: Number(r.points) || 0,
    fga: Number(r.fieldGoalsAttempted) || 0,
    fta: Number(r.freeThrowsAttempted) || 0,
    tov: Number(r.turnovers) || 0,
  });
}
const teams = new Map<string, { team: string; minutes: number }[]>();
const rosters = new Map<string, { pid: string; minutes: number }[]>();
for (const r of readCsv('playerSeasonTeams.csv')) {
  const key = `${r.personId}|${r.seasonEnd}`;
  const t = `${r.team}|${r.seasonEnd}`;
  const minutes = Number(r.minutes) || 0;
  (teams.get(key) ?? teams.set(key, []).get(key)!).push({ team: r.team, minutes });
  (rosters.get(t) ?? rosters.set(t, []).get(t)!).push({ pid: r.personId, minutes });
}

// Every usable teammate season: true shooting against the league, usage, age.
type Season = { pid: string; end: number; team: string; rel: number; usage: number; age: number | null; shots: number; games: number };
const seasons = new Map<string, Season>();
for (const [key, list] of teams) {
  const [pid, endStr] = key.split('|');
  const end = Number(endStr);
  const L = league.get(end);
  const s = stats.get(key);
  if (!L || !s || list.length !== 1 || s.minutes < MATE_MINUTES || s.fga < MATE_SHOTS) continue;
  const b = born.get(pid);
  seasons.set(key, {
    pid,
    end,
    team: list[0].team,
    rel: s.pts / (2 * (s.fga + 0.44 * s.fta)) - L.ts,
    usage: (0.2 * ((s.fga + 0.44 * s.fta + s.tov) / s.minutes)) / L.possPerMin,
    age: b ? end - b.getFullYear() - (b.getMonth() >= 1 ? 1 : 0) : null,
    shots: s.fga,
    games: s.games,
  });
}
// The age curve and the role (usage) slope, from the same player's consecutive seasons.
const byAge = new Map<number, { sum: number; weight: number }>();
const pairs: { dRel: number; dUsage: number; age: number | null; weight: number }[] = [];
for (const v of seasons.values()) {
  const next = seasons.get(`${v.pid}|${v.end + 1}`);
  if (!next || v.end < FROM) continue;
  const weight = Math.min(v.shots, next.shots);
  pairs.push({ dRel: next.rel - v.rel, dUsage: next.usage - v.usage, age: v.age, weight });
  if (v.age != null) {
    const a = byAge.get(v.age) ?? { sum: 0, weight: 0 };
    a.sum += (next.rel - v.rel) * weight;
    a.weight += weight;
    byAge.set(v.age, a);
  }
}
const ageStep = (age: number) => {
  const a = byAge.get(Math.max(20, Math.min(37, age)));
  return a && a.weight > 2000 ? a.sum / a.weight : 0;
};
const ageCurve = (age: number) => {
  let c = 0;
  for (let a = 25; a < age; a++) c += ageStep(a);
  for (let a = age; a < 25; a++) c -= ageStep(a);
  return c;
};
let sxy = 0;
let sxx = 0;
for (const p of pairs) {
  if (p.age == null) continue;
  const y = p.dRel - ageStep(p.age);
  sxy += p.weight * p.dUsage * y;
  sxx += p.weight * p.dUsage * p.dUsage;
}
const USAGE_SLOPE = sxy / sxx;

/** One player's measured lift: shot-weighted mean over his teammates, and its standard error. */
function measure(starPid: string): { lift: number; se: number; mates: number } | null {
  const starSeasons: { end: number; team: string }[] = [];
  const present = new Set<string>();
  for (const [key, list] of teams) {
    const [pid, end] = key.split('|');
    if (pid !== starPid) continue;
    for (const t of list) {
      present.add(`${t.team}|${end}`);
      if (t.minutes >= STAR_MINUTES) starSeasons.push({ end: Number(end), team: t.team });
    }
  }
  const mates = new Map<string, number[]>();
  for (const { end, team } of starSeasons) {
    for (const m of rosters.get(`${team}|${end}`) ?? []) if (m.pid !== starPid) (mates.get(m.pid) ?? mates.set(m.pid, []).get(m.pid)!).push(end);
  }
  const ok = (v: Season | undefined): v is Season => !!v && v.end >= FROM && v.games >= MATE_GAMES && v.age != null;
  const adj = (v: Season) => v.rel - ageCurve(v.age!);
  const rows: { d: number; weight: number }[] = [];
  for (const [pid, ends] of mates) {
    const beside = ends.map((e) => seasons.get(`${pid}|${e}`)).filter(ok);
    if (!beside.length) continue;
    const without: Season[] = [];
    for (let e = Math.min(...ends) - WINDOW; e <= Math.max(...ends) + WINDOW; e++) {
      const v = seasons.get(`${pid}|${e}`);
      if (ok(v) && !present.has(`${v.team}|${e}`)) without.push(v);
    }
    if (!without.length) continue;
    const avg = (xs: Season[], f: (x: Season) => number) => xs.reduce((s, x) => s + f(x) * x.shots, 0) / xs.reduce((s, x) => s + x.shots, 0);
    const dUsage = avg(beside, (x) => x.usage) - avg(without, (x) => x.usage);
    rows.push({
      d: avg(beside, adj) - avg(without, adj) - USAGE_SLOPE * dUsage,
      weight: Math.min(beside.reduce((s, x) => s + x.shots, 0), without.reduce((s, x) => s + x.shots, 0)),
    });
  }
  if (rows.length < MIN_MATES) return null;
  const W = rows.reduce((s, r) => s + r.weight, 0);
  const mean = rows.reduce((s, r) => s + r.d * r.weight, 0) / W;
  const sd = Math.sqrt(rows.reduce((s, r) => s + r.weight * (r.d - mean) ** 2, 0) / W);
  const effective = W ** 2 / rows.reduce((s, r) => s + r.weight ** 2, 0);
  return { lift: mean, se: sd / Math.sqrt(effective), mates: rows.length };
}

// Everyone with four seasons as a real part of a team since 1984-85.
const regular = new Map<string, number>();
for (const [key, list] of teams) {
  const [pid, end] = key.split('|');
  if (Number(end) >= FROM && list.some((t) => t.minutes >= STAR_MINUTES)) regular.set(pid, (regular.get(pid) ?? 0) + 1);
}
const measured = new Map<string, { lift: number; se: number; mates: number }>();
for (const [pid, n] of regular) {
  if (n < 4) continue;
  const m = measure(pid);
  if (m) measured.set(pid, m);
}
const all = [...measured.values()];
const leagueMean = all.reduce((s, m) => s + m.lift, 0) / all.length;
const variance = all.reduce((s, m) => s + (m.lift - leagueMean) ** 2, 0) / all.length;
const noise = all.reduce((s, m) => s + m.se ** 2, 0) / all.length;
const trueSpread = Math.max(1e-6, variance - noise);
/** Halfway between the measured lift and what its noise lets one trust (the user: "pośrodku"). */
const liftOf = new Map<string, number>();
for (const [pid, m] of measured) {
  const trust = trueSpread / (trueSpread + m.se ** 2);
  liftOf.set(pid, ((1 + trust) / 2) * (m.lift - leagueMean));
}

// Spans to people: the same name with the most minutes in the span's seasons.
const pidsByName = new Map<string, string[]>();
for (const [pid, name] of nameOf) (pidsByName.get(norm(name)) ?? pidsByName.set(norm(name), []).get(norm(name))!).push(pid);
const teamMinutes = new Map<string, number>();
for (const [t, list] of rosters) teamMinutes.set(t, list.reduce((s, m) => s + m.minutes, 0));

const out: Record<string, [number, number]> = {};
let matched = 0;
let lifted = 0;
for (const span of draftPool) {
  const ends = spanEndYears(span.spanLabel);
  const candidates = pidsByName.get(norm(span.playerName)) ?? [];
  let pid: string | null = null;
  let best = 0;
  for (const c of candidates) {
    const minutes = ends.reduce((s, e) => s + (stats.get(`${c}|${e}`)?.minutes ?? 0), 0);
    if (minutes > best) {
      best = minutes;
      pid = c;
    }
  }
  const lift = pid ? liftOf.get(pid) ?? 0 : 0;
  // His real teammates' lift: each by the share of the game he was on the floor, over his seasons.
  let mates = 0;
  let weight = 0;
  if (pid) {
    matched++;
    for (const e of ends) {
      for (const t of teams.get(`${pid}|${e}`) ?? []) {
        const total = teamMinutes.get(`${t.team}|${e}`) ?? 0;
        if (!total || !t.minutes) continue;
        let sum = 0;
        for (const m of rosters.get(`${t.team}|${e}`) ?? []) if (m.pid !== pid) sum += ((5 * m.minutes) / total) * (liftOf.get(m.pid) ?? 0);
        mates += sum * t.minutes;
        weight += t.minutes;
      }
    }
  }
  if (lift !== 0) lifted++;
  const row: [number, number] = [Math.round(lift * 1000), Math.round((weight ? mates / weight : 0) * 1000)];
  // Spans with neither number are left out (the lookup reads them as 0).
  if (row[0] || row[1]) out[span.id] = row;
}
writeFileSync(resolve(import.meta.dirname, '../src/data/teammateLift.json'), `${JSON.stringify(out).replace(/\],"/g, '],\n"')}\n`);
const show = (n: string) => {
  const pid = (pidsByName.get(norm(n)) ?? []).find((p) => measured.has(p));
  const m = pid ? measured.get(pid)! : null;
  return m ? `${n} ${(100 * (m.lift - leagueMean)).toFixed(1)}±${(100 * m.se).toFixed(1)} -> ${(100 * liftOf.get(pid!)!).toFixed(1)}` : `${n} -`;
};
console.log(
  `teammateLift.json: ${Object.keys(out).length} of ${draftPool.length} spans, ${matched} matched, ${lifted} with a lift; ${measured.size} players measured,`,
  `true spread ${(100 * Math.sqrt(trueSpread)).toFixed(2)} vs noise ${(100 * Math.sqrt(noise)).toFixed(2)}, usage slope ${USAGE_SLOPE.toFixed(3)}`,
);
console.log(['Magic Johnson', 'Steve Nash', 'Nikola Jokic', 'John Stockton', 'Stephen Curry', "Shaquille O'Neal", 'LeBron James', 'Chris Paul', 'Mike Conley', 'Michael Jordan'].map(show).join(' | '));
