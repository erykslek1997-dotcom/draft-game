/**
 * Takes the file saved by scripts/fetch_headshots_browser.js or fetch_bbref_headshots_browser.js
 * (2026-10-29) into the game: each photo becomes public/headshots/<id>.png at the size
 * scripts/resizeHeadshots.ts makes, and its player joins src/data/headshotIds.json. A BBRef photo
 * (`bb-<bbref id>`) is a tall portrait: it is cut to the square at its top, the head and shoulders,
 * so it sits in the same square tiles as the NBA's. A picture that comes back for many players at
 * once is the CDN's blank stand-in, not a face, and is left out.
 *
 * Run: npx tsx scripts/importHeadshots.ts path/to/headshots_nba.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const DIR = 'public/headshots';
const MANIFEST = 'src/data/headshotIds.json';
const MAX_WIDTH = 160;

const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/importHeadshots.ts headshots_nba.json');
const data = JSON.parse(readFileSync(file, 'utf8')) as {
  photos: Record<string, { name: string; webp?: string; jpg?: string; guessed?: boolean; page?: string }>;
  missing: [string, string, string][];
  errors: [string, string, string][];
};

const entries = Object.entries(data.photos);
const hash = (b64: string) => createHash('sha1').update(b64).digest('hex');
const seen = new Map<string, number>();
const bytes = (p: { webp?: string; jpg?: string }) => p.webp ?? p.jpg ?? '';
for (const [, p] of entries) seen.set(hash(bytes(p)), (seen.get(hash(bytes(p))) ?? 0) + 1);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Record<string, string>;
let written = 0;
let kept = 0;
const blank: string[] = [];
const guessed: string[] = [];
for (const [id, p] of entries) {
  if ((seen.get(hash(bytes(p))) ?? 0) > 2) {
    blank.push(p.name);
    continue;
  }
  const out = `${DIR}/${id}.png`;
  if (existsSync(out)) kept++;
  else {
    let img = sharp(Buffer.from(bytes(p), 'base64'));
    if (p.jpg) {
      const { width = 0, height = 0 } = await img.metadata();
      if (height > width) img = sharp(await img.extract({ left: 0, top: Math.min(height - width, Math.round(width * 0.06)), width, height: width }).toBuffer());
    }
    const buf = await img
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 82 })
      .toBuffer();
    writeFileSync(out, buf);
    written++;
  }
  manifest[p.name] = id;
  if (p.guessed) guessed.push(`${p.name} (${id}) → BBRef page: ${p.page ?? '?'}`);
}
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`);

console.log(`Headshots: ${written} written, ${kept} already there, ${blank.length} blank stand-ins left out.`);
console.log(`Without a photo at the source: ${data.missing.length}; errors: ${data.errors.length}.`);
for (const n of blank) console.log(`  blank: ${n}`);
for (const n of guessed) console.log(`  check, id was guessed: ${n}`);
for (const m of [...data.missing, ...data.errors]) console.log(`  ${m.join(' · ')}`);
