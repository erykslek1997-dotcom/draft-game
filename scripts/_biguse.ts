// 2026-11-26: which bigs the "three ball" rule reads as needing the ball (use >= 0.5, no off-ball star exemption).
import { draftPool } from '../src/data/draftPool';
import { dataUsageDemand, skill } from '../src/engine/skills';
import { effectiveTalent } from '../src/engine/grades';
const best = (n: string) => draftPool.filter((p) => p.playerName === n).sort((a, b) => effectiveTalent(b) - effectiveTalent(a))[0];
for (const n of ["Shaquille O'Neal",'Tim Duncan','Hakeem Olajuwon','Kareem Abdul-Jabbar','David Robinson','Kevin Garnett','Nikola Jokic','Joel Embiid','Dirk Nowitzki','Giannis Antetokounmpo','Anthony Davis','Patrick Ewing','Karl Malone','Charles Barkley','Pau Gasol','Bill Russell','Wilt Chamberlain','Moses Malone','Draymond Green','Rudy Gobert','Ben Wallace','Dennis Rodman','Bam Adebayo','Victor Wembanyama','Chris Webber','Kevin McHale']) {
  const p = best(n); if (!p) continue; const u = dataUsageDemand(p) ?? 0.3; console.log((u >= 0.5 && (skill(p, 'spotUp') ?? 0) < 80 ? 'NEEDS ' : '      '), n.padEnd(22), p.spanLabel, 'use', u.toFixed(2), 'spotUp', skill(p, 'spotUp'));
}
