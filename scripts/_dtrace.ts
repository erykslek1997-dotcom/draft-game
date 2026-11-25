import '../src/engine/scoring';
import { draftPool } from '../src/data/draftPool';
import { defensiveTalentTrace, computeDefensiveTalentBase, computeDefensiveTalent } from '../src/engine/defensiveTalent';
for (const [n, w] of [['Tyrese Haliburton','2022-24'],['Tyrese Haliburton','2023-25'],['Dennis Rodman','1989-91'],['Dennis Rodman','1990-92'],['Trae Young','2019-21']]) {
  const s = draftPool.find((p) => p.playerName === n && p.spanLabel === w)!;
  const t = defensiveTalentTrace(s) as Record<string, unknown>;
  console.log(n, w, 'final', computeDefensiveTalent(s), 'base', computeDefensiveTalentBase(s), JSON.stringify(Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'number' || typeof v === 'string').map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 10) / 10 : v]))));
}
