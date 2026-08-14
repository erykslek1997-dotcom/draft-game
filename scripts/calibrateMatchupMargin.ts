/**
 * One-off calibration for the matchup model (2026-08-14): the real single-game point-margin
 * standard deviation, needed to convert a projected net-rating differential (from
 * netRatingProjection.ts) into a single-game win probability via a normal-CDF approximation.
 * Measured directly from team_advanced.csv rather than assumed, same discipline as every other
 * anchored constant in this project. Margin per team-game recovered as NETRTG * PACE / 100
 * (points per 100 possessions * possessions per game / 100) — the same recovery formula noted in
 * [[game_advanced_boxscore_exports]] ("Team points are recoverable to ~±1 via OFFRTG × PACE ×
 * MIN/48 / 100"). Every row (both sides of every game) is used — margin from a symmetric
 * distribution around 0, so no double-counting bias.
 */
import fs from 'fs';

const TEAM_ADVANCED_CSV = 'C:\\Users\\Eryks\\Desktop\\team_advanced.csv';

const text = fs.readFileSync(TEAM_ADVANCED_CSV, 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
const header = lines[0].split(',');
const iType = header.indexOf('type');
const iNet = header.indexOf('NETRTG');
const iPace = header.indexOf('PACE');

const margins: number[] = [];
for (let i = 1; i < lines.length; i++) {
  const r = lines[i].split(',');
  if (r[iType] !== 'regular') continue;
  const net = parseFloat(r[iNet]);
  const pace = parseFloat(r[iPace]);
  if (!Number.isFinite(net) || !Number.isFinite(pace)) continue;
  margins.push((net * pace) / 100);
}

const n = margins.length;
const mean = margins.reduce((s, x) => s + x, 0) / n;
const variance = margins.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
const sd = Math.sqrt(variance);
console.log(`n=${n} mean=${mean.toFixed(3)} sd=${sd.toFixed(3)}`);

margins.sort((a, b) => a - b);
console.log(
  `min ${margins[0].toFixed(1)}  p5 ${margins[Math.floor(n * 0.05)].toFixed(1)}  median ${margins[Math.floor(n * 0.5)].toFixed(1)}  p95 ${margins[Math.floor(n * 0.95)].toFixed(1)}  max ${margins[n - 1].toFixed(1)}`,
);
