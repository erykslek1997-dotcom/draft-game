// 2026-11-26 (the user: "tą grawitację trzeba sprawdzić"): teammate lift (given) and real mates (received) for
// shooters and creators; does "received" grow with the player's own shooting (circular)?
import { draftPool } from '../src/data/draftPool';
import { effectiveTalent } from '../src/engine/grades';
import { teammateLift } from '../src/engine/teammateLift';
import { computeSpacing } from '../src/engine/spacing';
for (const n of ['Stephen Curry','Klay Thompson','Steve Nash','Ray Allen','Dirk Nowitzki','Reggie Miller','Kyle Korver','John Stockton','Chris Paul','LeBron James','Nikola Jokic','Magic Johnson','Michael Jordan','Kevin Durant','Damian Lillard','James Harden']) {
  const p = draftPool.filter((x) => x.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0]; if (!p) continue;
  const l = teammateLift(p); console.log(`${(n + ' ' + p.spanLabel).padEnd(26)} gives ${(l.lift * 100).toFixed(1)} receives ${(l.realMates * 100).toFixed(1)} net ${((l.lift - l.realMates) * 100).toFixed(1)} spc ${computeSpacing(p)}`);
}
const rows = draftPool.map((p) => ({ l: teammateLift(p), s: computeSpacing(p) })).filter((r) => r.l.lift !== 0 || r.l.realMates !== 0);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let ab = 0, aa = 0, bb = 0; a.forEach((v, i) => { ab += (v - ma) * (b[i] - mb); aa += (v - ma) ** 2; bb += (b[i] - mb) ** 2; }); return ab / Math.sqrt(aa * bb); };
console.log('windows', rows.length, 'corr(spacing, received)', corr(rows.map((r) => r.s), rows.map((r) => r.l.realMates)).toFixed(3), 'corr(spacing, given)', corr(rows.map((r) => r.s), rows.map((r) => r.l.lift)).toFixed(3));
for (const [lo, hi] of [[0, 40], [40, 70], [70, 90], [90, 101]]) { const g = rows.filter((r) => r.s >= lo && r.s < hi); console.log(`spacing ${lo}-${hi}: n ${g.length} given ${(mean(g.map((r) => r.l.lift)) * 100).toFixed(2)} received ${(mean(g.map((r) => r.l.realMates)) * 100).toFixed(2)}`); }
