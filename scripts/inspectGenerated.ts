import { generatedPlayers } from '../src/data/generatedPlayers';

const targets = ['Wembanyama', 'Gilgeous-Alexander', 'Rondo', 'George', 'Lillard', 'Booker', 'Edwards', 'Young', 'Mitchell', 'Brunson', 'Sabonis', 'Vucevic', 'Towns'];

for (const t of targets) {
  const matches = generatedPlayers.filter((p) => p.playerName.includes(t));
  for (const m of matches) {
    console.log(
      `${m.playerName} (${m.spanLabel}) [${m.primaryPosition}] FGA=${m.fga} PPG=${m.box.ppg} RPG=${m.box.rpg} APG=${m.box.apg} SPG=${m.box.spg} BPG=${m.box.bpg} 3PA=${m.box.threePA} -> ${m.offensiveArchetype} / ${m.defensiveRole}`,
    );
  }
}

console.log('\n--- Random sample of 15 ---');
const shuffled = [...generatedPlayers].sort(() => Math.random() - 0.5);
for (const p of shuffled.slice(0, 15)) {
  console.log(
    `${p.playerName} (${p.spanLabel}) [${p.primaryPosition}] FGA=${p.fga} PPG=${p.box.ppg} RPG=${p.box.rpg} APG=${p.box.apg} -> ${p.offensiveArchetype} / ${p.defensiveRole}`,
  );
}
