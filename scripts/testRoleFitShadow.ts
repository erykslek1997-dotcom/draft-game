import fs from 'fs';
import path from 'path';
import { HISTORICAL_MOVEMENT_SHOOTER_EVIDENCE } from '../src/data/historicalMovementShooters';
import { players } from '../src/data/players';
import { normalizePlayerName } from '../src/data/schema';
import { buildRoleFitContext, computeShadowRoleProfile } from '../src/engine/roleFitShadow';
import { classifyDefense, classifyOffense, type DerivedBox } from './lib/rawPlayerData';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const baseBox: DerivedBox = {
  ppg: 10, rpg: 4, apg: 2, spg: 1, bpg: 0.3, fgPct: 0.45, threePct: 0.37,
  threePA: 5, ftPct: 0.8, tsPct: 0.57, fga: 10,
};

check(
  classifyOffense('SG', { ...baseBox, ppg: 20, fga: 16, threePA: 7, threePct: 0.4, apg: 2.5 }) === 'Stationary Shooter',
  'box-only high-volume shooting is conservatively classified without inventing movement routes',
);
check(
  classifyOffense('SG', { ...baseBox, ppg: 16, fga: 11.5, threePA: 5.5, threePct: 0.41, apg: 2.5 }) === 'Stationary Shooter',
  'box-only medium-usage shooting is not promoted to Off Screen without route evidence',
);
check(
  classifyOffense('SF', { ...baseBox, ppg: 8.8, fga: 7.1, threePA: 4.3, threePct: 0.38, apg: 1.5 }) === 'Stationary Shooter',
  'a low-usage spot-up profile is not promoted to Off Screen Shooter',
);
check(
  classifyOffense('PG', { ...baseBox, ppg: 12.9, fga: 8.9, threePA: 5.3, threePct: 0.355, apg: 4.9 }) === 'Secondary Ball Handler',
  'a playmaking guard with average shooting is not promoted to Off Screen Shooter',
);
check(
  classifyOffense('PF', { ...baseBox, ppg: 6.3, fga: 4.8, threePA: 1.6, threePct: 0.332, apg: 1.7 }) === 'Stretch Big',
  'a stretch PF is not promoted to Off Screen Shooter',
);
check(
  classifyOffense('PF', { ...baseBox, ppg: 25, fga: 18, threePA: 5.8, apg: 5 }) === 'Shot Creator',
  'a perimeter-creator PF is no longer forced into a big offensive role',
);
check(
  classifyDefense('PF', { ...baseBox, rpg: 5, spg: 1.6, bpg: 0.5 }) === 'Wing Stopper',
  'a small-ball PF can reach a perimeter defensive role',
);
check(
  classifyDefense('PF', { ...baseBox, rpg: 9, spg: 0.6, bpg: 2 }) === 'Anchor Big',
  'a true rim-protecting PF can still reach Anchor Big',
);

const before = JSON.stringify(players.slice(0, 20));
const context = buildRoleFitContext(players);
const sampleProfiles = players.slice(0, 20).map((span) => computeShadowRoleProfile(span, context));
const after = JSON.stringify(players.slice(0, 20));
check(before === after, 'shadow scoring does not mutate PlayerSpan data');
check(sampleProfiles.every((profile) => profile.version === 'role-fit-shadow-v1'), 'every profile uses the versioned shadow schema');
check(players.every((span) => !('shadowRoleProfile' in span)), 'shadow profiles are not attached to production players');

for (const [name, label] of [['Shane Battier', '2007-09'], ['Marcus Smart', '2018-20'], ['Robert Horry', '1999-01']] as const) {
  const span = players.find((player) => player.playerName === name && player.spanLabel === label);
  check(Boolean(span), `${name} ${label} exists for the reported regression case`);
  const profile = computeShadowRoleProfile(span!, context);
  check(
    !profile.proposedOffensiveRoles.some((fit) => fit.role === 'Off Screen Shooter'),
    `${name} ${label} is not proposed as Off Screen Shooter`,
  );
  check(
    !profile.proposedOffensiveRoles.some((fit) => fit.role === 'Movement Shooter' || fit.role === 'Stationary Shooter'),
    `${name} ${label} is not silently moved to another unsupported shooter subtype`,
  );
}

const redick = players.find((player) => player.playerName === 'JJ Redick' && player.spanLabel === '2015-17');
check(Boolean(redick), 'JJ Redick 2015-17 exists as a positive Off Screen control');
check(
  computeShadowRoleProfile(redick!, context).proposedOffensiveRoles.some((fit) => fit.role === 'Off Screen Shooter'),
  'JJ Redick 2015-17 remains an Off Screen proposal using measured PBP support',
);

for (const name of ['Dale Ellis', 'Reggie Miller', 'Dell Curry', 'Ray Allen', 'Kyle Korver'] as const) {
  const profiles = players
    .filter((player) => player.playerName === name)
    .map((span) => computeShadowRoleProfile(span, context));
  check(profiles.length > 0, `${name} exists in the historical movement validation set`);
  check(
    profiles.some((profile) =>
      profile.incumbentOffensiveRole === 'Movement Shooter' ||
      profile.proposedOffensiveRoles.some((fit) => fit.role === 'Movement Shooter')),
    `${name} has at least one real-stat-supported Movement Shooter span`,
  );
}

for (const name of ['James Harden', 'Luka Doncic', 'Jayson Tatum'] as const) {
  const profiles = players
    .filter((player) => player.playerName === name)
    .map((span) => computeShadowRoleProfile(span, context));
  check(
    profiles.every((profile) => !profile.proposedOffensiveRoles.some((fit) => fit.role === 'Movement Shooter')),
    `${name} is not inferred as a Movement Shooter from pull-up volume`,
  );
}

const validatedMovementNames = new Set(
  HISTORICAL_MOVEMENT_SHOOTER_EVIDENCE.map((entry) => normalizePlayerName(entry.playerName)),
);
const inferredMovementNames = new Set(
  players
    .filter((span) =>
      computeShadowRoleProfile(span, context).proposedOffensiveRoles.some((fit) => fit.role === 'Movement Shooter'))
    .map((span) => normalizePlayerName(span.playerName)),
);
check(
  [...inferredMovementNames].every((name) => validatedMovementNames.has(name)),
  `every additional Movement proposal has explicit evidence (${[...inferredMovementNames].join(', ')})`,
);

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [file] : [];
  });
}

const roleModule = path.resolve('src/engine/roleFitShadow.ts');
const runtimeImports = sourceFiles(path.resolve('src'))
  .filter((file) => path.resolve(file) !== roleModule)
  .filter((file) => fs.readFileSync(file, 'utf8').includes('roleFitShadow'));
check(runtimeImports.length === 0, `no production module imports the shadow scorer (${runtimeImports.join(', ') || 'none'})`);

console.log('Role-fit shadow tests complete.');
