import { players } from '../src/data/players';
import { computeTalent } from '../src/engine/talent';
import { normalizePlayerName } from '../src/data/schema';

for (const name of ['Nikola Jokic', 'Domantas Sabonis', 'Bob McAdoo', 'Patrick Ewing', "Dwight Howard", 'Vlade Divac', 'Arvydas Sabonis', 'Bill Walton']) {
  const key = normalizePlayerName(name);
  for (const p of players.filter((pp) => normalizePlayerName(pp.playerName) === key && pp.primaryPosition === 'C')) {
    console.log(`${name.padEnd(20)} ${p.spanLabel.padEnd(8)} apg=${p.box.apg} FGA=${p.fga} TAL=${computeTalent(p)}`);
  }
}
