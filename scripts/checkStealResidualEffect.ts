import { players } from '../src/data/players';
import { computeTalent, computeDefensiveTalent } from '../src/engine/talent';
import { stealRateEraResidual } from '../src/engine/era';
import { normalizePlayerName } from '../src/data/schema';

for (const { name, span } of [
  { name: 'Clyde Drexler', span: '1988-90' },
  { name: 'Julius Erving', span: '1981-83' },
  { name: 'Scottie Pippen', span: '1993-95' },
  { name: 'Kawhi Leonard', span: '2015-17' },
  { name: 'Michael Jordan', span: '1986-88' },
  { name: 'Alvin Robertson', span: '1985-87' },
]) {
  const key = normalizePlayerName(name);
  const p = players.find((pp) => normalizePlayerName(pp.playerName) === key && pp.spanLabel === span);
  if (!p) { console.log(`${name} ${span} NOT FOUND`); continue; }
  console.log(
    `${name.padEnd(18)} ${span.padEnd(8)} spg=${p.box.spg} residual=${stealRateEraResidual(span).toFixed(3)} TAL=${computeTalent(p)} DTAL=${computeDefensiveTalent(p)}`,
  );
}
