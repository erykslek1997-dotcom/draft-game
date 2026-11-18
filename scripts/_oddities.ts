// 2026-11-18 (the user: "w każdym składzie jest coś dziwnego" — count it automatically): reads the
// JSON from `_draft2.ts` and counts four kinds of oddity per draft.
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tot = { wasted: 0, weak: 0, inverted: 0, dupBench: 0, teams: 0, picks: 0 };
const ex: Record<string, string[]> = { wasted: [], weak: [], inverted: [], dupBench: [] };
for (const dr of d) {
  for (const p of dr.picks ?? []) { tot.picks++; if (p.pick <= 80 && p.bestTal - p.tal >= 8) { tot.wasted++; ex.wasted.push(`s${dr.seed} #${p.pick} ${p.team.split(' ').pop()}: ${p.n} ${p.tal} (był ${p.best} ${p.bestTal})`); } }
  const sums = dr.teams.map((t: any) => t.players.filter((p: any) => p.st).reduce((a: number, p: any) => a + p.tal, 0));
  const order = [...sums].map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  dr.teams.forEach((t: any, i: number) => {
    tot.teams++;
    const st = t.players.filter((p: any) => p.st);
    for (const p of st) if (p.tal < 75) { tot.weak++; ex.weak.push(`s${dr.seed} ${t.name.split(' ').pop()}: ${p.n} ${p.tal}`); }
    const talRank = order.indexOf(i);
    if (i - talRank >= 5) { tot.inverted++; ex.inverted.push(`s${dr.seed} ${t.name.split(' ').pop()}: talent piątki #${talRank + 1}, tabela #${i + 1}`); }
    const stBest = Math.min(...st.map((p: any) => p.tal));
    for (const p of t.players.filter((p: any) => !p.st && p.min > 0)) if (p.tal >= stBest + 5) { tot.dupBench++; ex.dupBench.push(`s${dr.seed} ${t.name.split(' ').pop()}: ${p.n} ${p.tal} na ławce`); }
  });
}
const n = d.length;
console.log(`${n} draftów, ${tot.teams} drużyn`);
console.log(`zmarnowane wybory (top 80, lepszy o 8+): ${tot.wasted}  (${(tot.wasted / n).toFixed(1)}/draft)`);
console.log(`słabi starterzy (<75): ${tot.weak}  (${(tot.weak / n).toFixed(1)}/draft)`);
console.log(`odwrócona kolejność (5+ miejsc): ${tot.inverted}  (${(tot.inverted / n).toFixed(1)}/draft)`);
console.log(`lepszy na ławce niż starter (5+): ${tot.dupBench}  (${(tot.dupBench / n).toFixed(1)}/draft)`);
if (process.argv[3] === 'v') for (const [k, v] of Object.entries(ex)) console.log(`\n${k}:\n  ` + v.slice(0, 25).join('\n  '));
