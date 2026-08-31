import { players } from '../src/data/players';
import { draftPool } from '../src/data/draftPool';
import { computeDefensiveTalent, computeOffensiveTalent, dtalBridgeCorrection } from '../src/engine/talent';
import { readFileSync } from 'node:fs';
const A = JSON.parse(readFileSync(process.env.TEMP+'/snap_before.json','utf8'));
const B = JSON.parse(readFileSync(process.env.TEMP+'/snap_after.json','utf8'));
const poolIds = new Set(draftPool.map(s=>s.id));
const byId = new Map(players.map(p=>[p.id,p]));
const rank = {'Cigarette Butt':0,'Bench Warmer':1,'Role Player':2,'Sixth Man':2,'Starter':3,'All-star':4,'All-NBA':5,'MVP':6,'Greatest peak':7,'GOAT':8};
type Row = {name:string,span:string,pos:string,from:string,to:string,corr:number,dtal:number,otal:number,etalA:number,etalB:number};
const rows:Row[] = [];
for (const id of Object.keys(B.tier)) {
  if (!A.tier[id] || A.tier[id]===B.tier[id]) continue;
  if ((rank[A.tier[id]]??0) < 4 && (rank[B.tier[id]]??0) < 4) continue; // skip pure sub-All-star churn
  const p = byId.get(id);
  rows.push({name:p.playerName,span:p.spanLabel,pos:p.primaryPosition,from:A.tier[id],to:B.tier[id],corr:+dtalBridgeCorrection(p).toFixed(1),dtal:computeDefensiveTalent(p),otal:computeOffensiveTalent(p),etalA:A.etal[id],etalB:B.etal[id]});
}
const up = rows.filter(r=>(rank[r.to]??0)>(rank[r.from]??0)).sort((a,b)=>(rank[b.to]-rank[a.to])||b.corr-a.corr);
const dn = rows.filter(r=>(rank[r.to]??0)<(rank[r.from]??0)).sort((a,b)=>(rank[b.from]-rank[a.from])||a.corr-b.corr);
const fmt=(r:Row)=>`  ${(r.name+' '+r.span).padEnd(30)} ${r.pos} ${r.from.padEnd(12)}->${r.to.padEnd(12)} corr ${String(r.corr).padStart(5)}  D-TAL ${String(r.dtal).padStart(3)} O-TAL ${String(r.otal).padStart(3)}  etal ${r.etalA}->${r.etalB}`;
console.log(`\n===== UP (${up.length}) =====`); up.forEach(r=>console.log(fmt(r)));
console.log(`\n===== DOWN (${dn.length}) =====`); dn.forEach(r=>console.log(fmt(r)));
