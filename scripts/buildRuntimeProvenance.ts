/** Builds the compact curated-id index used by browser-side provenance badges. */
import { writeFileSync } from 'node:fs';
import { curatedPlayers } from '../src/data/players';

const ids = curatedPlayers.map((span) => span.id).sort();
writeFileSync('src/data/curatedPlayerIds.json', JSON.stringify(ids));
console.log(`Wrote src/data/curatedPlayerIds.json: ${ids.length} curated spans.`);
