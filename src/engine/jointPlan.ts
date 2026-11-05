import type { PlayerSpan, Position } from '../data/schema';
import { normalizePlayerName } from '../data/schema';
import { effectiveTalent } from './grades';
import { STARTER_SLOTS, ROSTER_SIZE } from './positions';
import { backupOptions, readStructure, STRUCTURE } from './structuredRoster';

/**
 * 2026-11-05, the user ("każde AI przed draftem planuje składy żeby sobie nie przeszkadzać, więc
 * zanim padnie jeszcze pierwszy pick to robimy bramki które muszą przejść zanim padną picki. Żeby
 * tylko się nie zablokowało"): before the first CPU pick the CPU teams split the board between them.
 *
 *  1. A fast simulated draft in the real (snake) order. The human is stood in for by a best-available
 *     drafter; each CPU team takes, on its turn, the best player for one of its open roles (five
 *     starters at their own positions, three backups on adjacent pairs that together cover all five
 *     spots, one glue of `STRUCTURE.glueFga` shots) that leaves enough cap for the roles still open.
 *  2. Gates, per CPU team: a full roster, within the cap, with no break in the structure
 *     (`readStructure`). A team that fails is mended with swaps against the players nobody planned for.
 *  3. Never blocking: the mending stops after `JOINT_PLAN.maxFixes` swaps or `JOINT_PLAN.budgetMs`,
 *     and the draft goes on with the plans as they are (the failed gates are reported). Pick legality
 *     is untouched, so the draft can always finish.
 */
export const JOINT_PLAN = { backupMaxFga: 10, shotCost: 0.8, backupWeight: 0.55, glueShotCost: 3, maxFixes: 400, budgetMs: 1500, minFillFga: 3 };

export interface JointPlanTeam {
  id: string;
  isHuman: boolean;
  roster: PlayerSpan[];
}
export interface JointPlanResult {
  /** Planned players by CPU team id, normalized names. */
  plans: Map<string, string[]>;
  /** Gates a CPU team's plan still fails, by team id (empty: all passed). */
  failures: Map<string, string[]>;
  ms: number;
}

type Role = { kind: 'starter'; slot: Position } | { kind: 'backup'; pairs: [Position, Position][] } | { kind: 'glue' };

interface Build {
  roster: PlayerSpan[];
  starters: Set<Position>;
  backups: [Position, Position][][];
  glue: boolean;
  spent: number;
}

const key = (p: PlayerSpan) => normalizePlayerName(p.playerName);

/** Uncovered positions once the backups are on: a backup covers either half of any pair he plays. */
function coverageLeft(backups: [Position, Position][][]): number {
  // Best covering choice of one pair per backup (three backups at most: brute force).
  let best = STARTER_SLOTS.length;
  const walk = (i: number, covered: Set<Position>) => {
    if (i === backups.length) {
      best = Math.min(best, STARTER_SLOTS.filter((s) => !covered.has(s)).length);
      return;
    }
    for (const pair of backups[i]) walk(i + 1, new Set([...covered, ...pair]));
  };
  walk(0, new Set());
  return best;
}

const pairsMemo = new Map<string, [Position, Position][]>();
function pairsOf(p: PlayerSpan): [Position, Position][] {
  let hit = pairsMemo.get(p.id);
  if (!hit) {
    hit = backupOptions(p);
    pairsMemo.set(p.id, hit);
  }
  return hit;
}

function rolesFor(build: Build, p: PlayerSpan): Role[] {
  const roles: Role[] = [];
  if (!build.starters.has(p.primaryPosition)) roles.push({ kind: 'starter', slot: p.primaryPosition });
  const pairs = pairsOf(p);
  // A backup is a 10-14-minute man: never a star on his shots (Hakeem as Fresno's PF/C "backup"
  // beside Jokić — the reading starts the best natural, so Jokić was left the glue).
  if (pairs.length && build.backups.length < 3 && p.fga <= JOINT_PLAN.backupMaxFga) {
    const next = [...build.backups, pairs];
    // The remaining backups (two positions each, at most) must still be able to cover what is left.
    if (coverageLeft(next) <= 2 * (3 - next.length)) roles.push({ kind: 'backup', pairs });
  }
  if (!build.glue && p.fga <= STRUCTURE.glueFga) roles.push({ kind: 'glue' });
  return roles;
}

function roleValue(p: PlayerSpan, role: Role): number {
  const tal = effectiveTalent(p);
  if (role.kind === 'starter') return tal - JOINT_PLAN.shotCost * p.fga;
  if (role.kind === 'backup') return JOINT_PLAN.backupWeight * tal - JOINT_PLAN.shotCost * p.fga;
  return 0.05 * tal - JOINT_PLAN.glueShotCost * p.fga;
}

function openRoles(build: Build): number {
  return 5 - build.starters.size + (3 - build.backups.length) + (build.glue ? 0 : 1);
}

function apply(build: Build, p: PlayerSpan, role: Role): void {
  build.roster.push(p);
  build.spent += p.fga;
  if (role.kind === 'starter') build.starters.add(role.slot);
  else if (role.kind === 'backup') build.backups.push(role.pairs);
  else build.glue = true;
}

function buildFrom(roster: PlayerSpan[]): Build {
  // Reading an existing roster into roles: the structure's own reading.
  const s = readStructure(roster);
  return {
    roster: [...roster],
    starters: new Set(STARTER_SLOTS.filter((slot) => s.starters[slot])),
    backups: s.backups.map((b) => [b.pair]),
    glue: s.glue.length > 0,
    spent: roster.reduce((sum, p) => sum + p.fga, 0),
  };
}

/**
 * The joint plan from a draft position. `order` is the team index of every pick still to come;
 * `pool` the windows on the board (one per player is used: the best for each role's value).
 */
export function buildJointPlan(teams: JointPlanTeam[], order: number[], pool: PlayerSpan[], capLimit: number, now: () => number = Date.now): JointPlanResult {
  const t0 = now();
  const byName = new Map<string, PlayerSpan[]>();
  for (const p of pool) {
    const k = key(p);
    const list = byName.get(k);
    if (list) list.push(p);
    else byName.set(k, [p]);
  }
  const taken = new Set<string>(teams.flatMap((t) => t.roster.map(key)));
  const starterValue = new Map(pool.map((p) => [p.id, roleValue(p, { kind: 'starter', slot: p.primaryPosition })]));
  // Glue values sit below the starter bound by construction, so the scan reaches them only late;
  // they are checked separately below.
  const ranked = [...pool].sort((a, b) => starterValue.get(b.id)! - starterValue.get(a.id)!);
  const glueRanked = pool.filter((p) => p.fga <= STRUCTURE.glueFga).sort((a, b) => roleValue(b, { kind: 'glue' }) - roleValue(a, { kind: 'glue' }));
  const builds = teams.map((t) => buildFrom(t.roster));
  const free = () => [...byName.keys()].filter((k) => !taken.has(k));

  for (const teamIdx of order) {
    const team = teams[teamIdx];
    const build = builds[teamIdx];
    if (build.roster.length >= ROSTER_SIZE) continue;
    if (team.isHuman) {
      // Stand-in for the human: the best player left, any role.
      let best: PlayerSpan | null = null;
      for (const k of free()) for (const p of byName.get(k)!) if (p.fga <= capLimit - build.spent && (!best || effectiveTalent(p) > effectiveTalent(best))) best = p;
      if (best) {
        taken.add(key(best));
        build.roster.push(best);
        build.spent += best.fga;
      }
      continue;
    }
    const slotsAfter = ROSTER_SIZE - build.roster.length - 1;
    let choice: { p: PlayerSpan; role: Role; v: number } | null = null;
    // Windows in order of their best possible role value (the starter one): once that bound is
    // under the best found, nothing further down can beat it.
    for (const p of ranked) {
      if (choice && starterValue.get(p.id)! <= choice.v) break;
      if (taken.has(key(p))) continue;
      {
        if (build.spent + p.fga > capLimit - slotsAfter * JOINT_PLAN.minFillFga) continue;
        for (const role of rolesFor(build, p)) {
          // Every pick fills a role; a pick that would leave more open roles than slots is out.
          if (openRoles(build) - 1 > slotsAfter) continue;
          const v = roleValue(p, role);
          if (!choice || v > choice.v) choice = { p, role, v };
        }
      }
    }
    // The glue's value is far under any starter bound: it competes only when nothing else fits.
    if (!choice && !build.glue) {
      const g = glueRanked.find((p) => !taken.has(key(p)) && build.spent + p.fga <= capLimit - slotsAfter * JOINT_PLAN.minFillFga);
      if (g) choice = { p: g, role: { kind: 'glue' }, v: 0 };
    }
    if (choice) {
      taken.add(key(choice.p));
      apply(build, choice.p, choice.role);
    }
  }

  // Gates and mending — the budget counts from here, so a slow simulation never skips the mending.
  const tMend = now();
  const gate = (b: Build): string[] => {
    const out: string[] = [];
    if (b.roster.length < ROSTER_SIZE) out.push(`roster ${b.roster.length}/${ROSTER_SIZE}`);
    if (b.spent > capLimit + 1e-9) out.push(`over the cap (${b.spent.toFixed(1)})`);
    out.push(...readStructure(b.roster).problems);
    return out;
  };
  let fixes = 0;
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].isHuman) continue;
    let fails = gate(builds[i]);
    const locked = new Set(teams[i].roster.map((p) => p.id));
    // A short plan first takes the best free player for an open role that still fits the cap.
    while (builds[i].roster.length < ROSTER_SIZE && now() - tMend < JOINT_PLAN.budgetMs) {
      const b = builds[i];
      const room = capLimit - b.spent - (ROSTER_SIZE - b.roster.length - 1) * JOINT_PLAN.minFillFga;
      let add: { p: PlayerSpan; role: Role; v: number } | null = null;
      for (const k of free()) for (const p of byName.get(k)!) {
        if (p.fga > room) continue;
        for (const role of rolesFor(b, p)) { const v = roleValue(p, role); if (!add || v > add.v) add = { p, role, v }; }
      }
      if (!add) {
        // No role fits: the cheapest free player keeps the roster full.
        const cheapest = free().flatMap((k) => byName.get(k)!).filter((p) => p.fga <= capLimit - b.spent).sort((a, c) => a.fga - c.fga)[0];
        if (!cheapest) break;
        taken.add(key(cheapest));
        b.roster.push(cheapest);
        b.spent += cheapest.fga;
        continue;
      }
      taken.add(key(add.p));
      apply(b, add.p, add.role);
    }
    fails = gate(builds[i]);
    while (fails.length && fixes < JOINT_PLAN.maxFixes && now() - tMend < JOINT_PLAN.budgetMs) {
      let improved = false;
      const roster = builds[i].roster;
      for (let j = 0; j < roster.length && !improved; j++) {
        if (locked.has(roster[j].id)) continue;
        for (const k of free()) {
          for (const p of byName.get(k)!) {
            fixes++;
            const next = roster.map((x, m) => (m === j ? p : x));
            const spent = next.reduce((sum, x) => sum + x.fga, 0);
            if (spent > capLimit + 1e-9) continue;
            if (gate({ ...buildFrom(next) }).length < fails.length) {
              taken.delete(key(roster[j]));
              taken.add(key(p));
              builds[i] = buildFrom(next);
              fails = gate(builds[i]);
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
      }
      if (!improved) break;
    }
  }

  const plans = new Map<string, string[]>();
  const failures = new Map<string, string[]>();
  teams.forEach((t, i) => {
    if (t.isHuman) return;
    plans.set(t.id, builds[i].roster.filter((p) => !t.roster.some((r) => r.id === p.id)).map(key));
    const f = gate(builds[i]);
    if (f.length) failures.set(t.id, f);
  });
  return { plans, failures, ms: now() - t0 };
}
