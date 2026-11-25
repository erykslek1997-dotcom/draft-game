// 2026-11-25: Curry as an off-ball shooter beside other stars — the all-time-five repro and controls.
import { draftPool } from '../src/data/draftPool';
import { autoAssignRotation, primaryStarters } from '../src/engine/rotation';
import * as S from '../src/engine/scoring';
import { projectMatchup } from '../src/engine/matchup';
import { heliocentricAdjustment } from '../src/engine/heliocentric';
import { reviewAdjustment } from '../src/engine/reviewRules';
import { skill, dataUsageDemand } from '../src/engine/skills';
const first = (n: string) => draftPool.find((p) => p.playerName === n)!;
const f = (n: string) => { const m = n.match(/^(.*) (\d{4}-\d{2})$/)!; const s = draftPool.find((p) => p.playerName === m[1] && p.spanLabel === m[2]); if (!s) throw new Error(n); return s; };
const bench = ['Jamal Murray', 'Mikal Bridges', 'Robert Covington', 'Tree Rollins'].map(first);
const team = (id: string, five: string[]) => { const r = [...five.map(f), ...bench]; return { id, name: id, draftSlot: 1, isHuman: false, roster: r, rotation: autoAssignRotation(r) } as any; };
const A = ['Stephen Curry 2014-16', 'Michael Jordan 1987-89', 'LeBron James 2012-14', 'Kevin Garnett 2002-04', 'David Robinson 1993-95'];
const B = ['John Stockton 1990-92', 'Michael Jordan 1987-89', 'Larry Bird 1985-87', 'Kawhi Leonard 2015-17', 'David Robinson 1993-95'];
const swap = (five: string[], who: string) => [who, ...five.slice(1)];
const weak = ['Stephen Curry 2014-16', 'Shane Battier 2006-08', 'Boris Diaw 2013-15', 'Al Horford 2016-18', 'Tyson Chandler 2011-13'];
const rows: [string, string[]][] = [['A (Curry)', A], ['B (Stockton/Bird/Kawhi)', B], ['A + Stockton', swap(A, 'John Stockton 1990-92')], ['A + Westbrook', swap(A, 'Russell Westbrook 2015-17')], ['A + Ray Allen', swap(A, process.env.RAY ?? 'Ray Allen 2000-02')], ['A + Klay', swap(A, 'Klay Thompson 2014-16')], ['weak (Curry alone)', weak], ['weak + Westbrook', swap(weak, 'Russell Westbrook 2015-17')]];
const tB = team('B', B);
for (const [lab, five] of rows) {
  const t = team(lab, five); const b: any = S.scoreTeam(t); const st = primaryStarters(t).map((a: any) => a.player);
  const fga = st.reduce((a: number, p: any) => a + p.fga, 0); const g = five[0] ? f(five[0]) : null;
  console.log(`${lab.padEnd(24)} ovr ${b.overallExact.toFixed(1)} O ${b.offenseScore} D ${b.defenseScore} fit ${Math.round(b.fitScore)} spc ${b.spacingScore} FGA ${fga.toFixed(1)} margin vs B ${lab.startsWith('B') ? '—' : projectMatchup(t, tB, undefined, undefined, 'playoffs').marginA.toFixed(1)} | otal ${S.offenseScoreBreakdown(t).otal.toFixed(1)} raw ${S.offenseScoreBreakdown(t).raw.toFixed(1)} ballH ${S.ballHandlerAdjustment(t).toFixed(1)} load ${S.ballLoadAdjustment(t).toFixed(1)} helio ${heliocentricAdjustment(t).toFixed(1)} review ${reviewAdjustment(st).toFixed(1)} | lead use ${dataUsageDemand(g!)?.toFixed(2)} spotUp ${skill(g!, 'spotUp')}`);
}
import { liftAdjustment } from '../src/engine/teammateLift'; import { chemistryAdjustment } from '../src/engine/chemistry'; import { reviewRuleHits } from '../src/engine/reviewRules';
console.log('\nA vs A+Stockton, every part:');
for (const [lab, five] of [rows[0], rows[2], rows[4]] as [string, string[]][]) { const t = team(lab + 'x', five); const b: any = S.scoreTeam(t); const st = primaryStarters(t).map((a: any) => a.player);
  console.log(lab.padEnd(14), `T ${b.talentScore} B ${b.benchDepthScore} R ${b.rotationScore} F ${Math.round(b.fitScore)} O ${b.offenseScore} D ${b.defenseScore}`, `era ${S.eraAdjustment(t).toFixed(2)} chem ${chemistryAdjustment(t).toFixed(2)} lift ${liftAdjustment(t).toFixed(2)} benchFloor ${S.benchFloorAdjustment(t).toFixed(2)} benchRole ${S.benchRoleAdjustment(t).toFixed(2)} cert ${S.dataCertaintyAdjustment(t).toFixed(2)}`, JSON.stringify(Object.fromEntries(Object.entries(reviewRuleHits(st)).filter(([, v]) => v))), 'off', JSON.stringify(S.offenseScoreBreakdown(t), (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v).slice(0, 220)); }
