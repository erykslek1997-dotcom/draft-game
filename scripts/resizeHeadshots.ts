/**
 * Downscale `public/headshots/*.png` in place to a web-appropriate size — the source images are
 * full-res NBA headshots (~125 KB each, 90 MB total), but they display at 26-72 px. 160 px wide
 * covers 2x retina at the largest use (the Card Collection portrait) with headroom.
 *
 * Run: npx tsx scripts/resizeHeadshots.ts   (needs `sharp`, a devDependency)
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = 'public/headshots';
const MAX_WIDTH = 160;

const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
let before = 0;
let after = 0;
let done = 0;

for (const f of files) {
  const path = join(DIR, f);
  before += statSync(path).size;
  const buf = await sharp(path)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 82 })
    .toBuffer();
  writeFileSync(path, buf);
  after += buf.length;
  if (++done % 100 === 0) process.stdout.write(`  ${done}/${files.length}\n`);
}

console.log(
  `resized ${files.length} headshots: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB ` +
    `(avg ${Math.round(after / files.length / 1024)} KB)`,
);
