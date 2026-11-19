import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation, allAssignments } from '../src/engine/rotation';
import { offenseScoreBreakdown, offensiveCohesion, superstarEngineBonus } from '../src/engine/scoring';
import { teamGlass } from '../src/engine/teamGlass';
import { realResidualPoints } from '../src/engine/realTeamResiduals';
const L: Record<string, string[]> = {
  jordan: ['Kyle Lowry 2015-17', 'Michael Jordan 1990-92', 'Clifford Robinson 1999-01', 'Evan Mobley 2024-26', 'Dikembe Mutombo 1996-98'],
  shaqHarden: ['Mark Price 1988-90', 'James Harden 2014-16', 'Scottie Pippen 1995-97', 'Pau Gasol 2016-18', "Shaquille O'Neal 1999-01"],
  wadeKg: ['John Stockton 1990-92', 'Dwyane Wade 2008-10', 'Gordon Hayward 2015-17', 'Kevin Garnett 2002-04', 'Brook Lopez 2018-20'],
  curry: ['Stephen Curry 2015-17', 'Klay Thompson 2015-17', 'Jimmy Butler 2015-17', 'Evan Mobley 2024-26', 'Bill Russell 1957-59'],
  doncic: ['Jason Kidd 2008-10', 'Luka Doncic 2022-24', 'Paul Pierce 2007-09', 'Anthony Davis 2019-21', 'Dwight Howard 2008-10'],
  shaqHali: ['Tyrese Haliburton 2021-23', 'Ray Allen 2001-03', 'Kawhi Leonard 2022-24', 'Shawn Kemp 1994-96', "Shaquille O'Neal 2001-03"],
  stockton: ['John Stockton 1990-92', 'Derrick White 2023-25', 'Gordon Hayward 2015-17', 'Kevin Garnett 2006-08', 'Kristaps Porziņģis 2022-24'],
  hill: ['Mark Price 1988-90', 'Reggie Miller 1993-95', 'Grant Hill 1998-00', 'Shane Battier 2004-06', 'David Robinson 1997-99'],
  curryNoRussell: ['Stephen Curry 2015-17', 'Klay Thompson 2015-17', 'Jimmy Butler 2015-17', 'Evan Mobley 2024-26', 'Al Horford 2016-18'],
};
for (const [k, ns] of Object.entries(L)) {
  const roster = ns.map((n) => { const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; return draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2])!; });
  const team = { id: k, name: k, draftSlot: 1, isHuman: false, roster, rotation: autoAssignRotation(roster) } as any;
  const b: any = offenseScoreBreakdown(team);
  console.log(k.padEnd(15), 'score', b.score, 'raw', b.raw?.toFixed(1), '| otal', b.otal?.toFixed(0), 'spc', b.spacing?.toFixed(0), '+eng', b.engineSpacingCover?.toFixed(0), '+int', b.interiorSpacingCover?.toFixed(0), 'rim', b.rimPressure?.toFixed(0), 'pm', b.playmaking?.toFixed(0), 'self', b.selfCreation?.toFixed(0), 'mism', b.mismatchStructure?.toFixed(0), '| coh', offensiveCohesion(team).offenseScoreBonus.toFixed(1), 'star', superstarEngineBonus(team).toFixed(1), 'glass', teamGlass(team).offensePoints.toFixed(1), 'resid', realResidualPoints(allAssignments(team), 'offense').toFixed(1));
}
