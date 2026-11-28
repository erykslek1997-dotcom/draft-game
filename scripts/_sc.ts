import { draftPool } from '../src/data/draftPool';
import { selfCreationRate } from '../src/engine/spacing';
import { skill } from '../src/engine/skills';
for (const [n,s] of [['David Robinson','91-93'],['Hakeem Olajuwon','92-94'],['Kareem Abdul-Jabbar','75-77'],['Patrick Ewing','89-91'],['Mark Price','86-88'],['Reggie Miller','89-91'],['Glen Rice','92-94'],['Sam Perkins','94-96'],['Moses Malone','80-82']]) { const p:any=draftPool.find(x=>x.playerName===n&&x.spanLabel.endsWith(s)); console.log(n.padEnd(22),s,p.offensiveArchetype.padEnd(22),'fga',p.fga,'rate',selfCreationRate(p).toFixed(2),'skill',skill(p,'selfCreation')); }
