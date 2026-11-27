import { draftPool } from '../src/data/draftPool';
import { realTeamResidual, REAL_RES_SCALE } from '../src/engine/realTeamResiduals';
for (const n of ['Stephen Curry','Michael Jordan','Kawhi Leonard','LeBron James','Larry Bird','Kevin Garnett','Kevin Durant','Magic Johnson','John Stockton']) { const p = draftPool.find((x) => x.playerName === n)!; const r = realTeamResidual(p); console.log(n.padEnd(16), 'off', r.offense.toFixed(2), '→ score pts at 36 min', (REAL_RES_SCALE * 0.75 * r.offense / 0.164).toFixed(1), ' def', r.defense.toFixed(2)); }
