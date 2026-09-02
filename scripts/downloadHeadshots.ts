/**
 * Downloads one NBA headshot per player in the production draft database.
 *
 * NBA person IDs come from src/data/raw/players_bio.csv. Player names are used only to
 * join that ID source to src/data/draftPool.json; they are never used to construct URLs.
 * Existing image files are an immutable cache and are always skipped.
 *
 * Run: npm run download:headshots
 * Optional: npm run download:headshots -- --dry-run --limit 10 --concurrency 4
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePlayerName } from '../src/data/schema';

const BIO_PATH = path.resolve('src/data/raw/players_bio.csv');
const PLAYER_DATABASE_PATH = path.resolve('src/data/draftPool.json');
const OUTPUT_DIR = path.resolve('public/headshots');
const REPORT_PATH = path.resolve('missing-headshots.json');
const MANIFEST_PATH = path.resolve('src/data/headshotIds.json');
const HEADSHOT_BASE_URL = 'https://cdn.nba.com/headshots/nba/latest/1040x760';
const DEFAULT_CONCURRENCY = 8;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PLAYER_NAME_ALIASES: Record<string, string> = {
  'art williams': 'arthur williams',
  'barry clemens': 'john clemens',
  'fat lever': 'lafayette lever',
  'kenny sears': 'ken sears',
  'michael ray richardson': 'micheal ray richardson',
  nene: 'nene hilario',
  'ron artest': 'metta world peace',
  'steve smith': 'steven smith',
  'tiny archibald': 'nate archibald',
  'world b free': 'world free',
};

interface DraftPlayerRecord {
  playerName: string;
  spanLabel: string;
}

interface BioRecord {
  nbaId: string;
  playerName: string;
  normalizedName: string;
  fromYear?: number;
  toYear?: number;
}

interface PlayerIdentity {
  playerName: string;
  normalizedName: string;
  spanYears: number[];
}

interface DownloadTarget extends PlayerIdentity {
  nbaId: string;
}

interface MissingHeadshot {
  playerName: string;
  nbaId: string | null;
  reason: string;
  httpStatus?: number;
  contentType?: string;
}

interface CliOptions {
  concurrency: number;
  dryRun: boolean;
  limit?: number;
}

function compactName(name: string): string {
  return normalizePlayerName(name)
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+(?:jr|sr|ii|iii|iv)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityName(name: string): string {
  const normalized = compactName(name);
  return PLAYER_NAME_ALIASES[normalized] ?? normalized;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function optionalYear(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSpanYears(spanLabel: string): number[] {
  const match = spanLabel.match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) return spanLabel.match(/\d{4}/g)?.map(Number) ?? [];
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end += Math.floor(start / 100) * 100;
    if (end < start) end += 100;
  }
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

function parseBioDatabase(csv: string): BioRecord[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines.shift() ?? '');
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`Missing required ${name} column in ${BIO_PATH}`);
    return index;
  };
  const personIdIndex = column('personId');
  const firstNameIndex = column('firstName');
  const lastNameIndex = column('lastName');
  const fromYearIndex = column('fromYear');
  const toYearIndex = column('toYear');

  return lines.flatMap((line): BioRecord[] => {
    const values = parseCsvLine(line);
    const nbaId = values[personIdIndex]?.trim();
    const playerName = `${values[firstNameIndex]?.trim() ?? ''} ${values[lastNameIndex]?.trim() ?? ''}`.trim();
    // nbaFlag is blank for many confirmed NBA players in this export (including Chris Paul),
    // so membership in the production draft database is the reliable NBA-player filter here.
    if (!/^\d+$/.test(nbaId) || !playerName) return [];
    return [{
      nbaId,
      playerName,
      normalizedName: identityName(playerName),
      fromYear: optionalYear(values[fromYearIndex]),
      toYear: optionalYear(values[toYearIndex]),
    }];
  });
}

function uniquePlayers(records: DraftPlayerRecord[]): PlayerIdentity[] {
  const byName = new Map<string, PlayerIdentity>();
  for (const record of records) {
    const normalizedName = identityName(record.playerName);
    // Keep distinct people in the production database distinct (for example Larry Nance and
    // Larry Nance Jr.). Suffix removal belongs only to the bio join key above.
    const databaseKey = record.playerName;
    const current = byName.get(databaseKey) ?? { playerName: record.playerName, normalizedName, spanYears: [] };
    current.spanYears.push(...parseSpanYears(record.spanLabel));
    byName.set(databaseKey, current);
  }
  return [...byName.values()]
    .map((player) => ({ ...player, spanYears: [...new Set(player.spanYears)] }))
    .sort((left, right) => left.playerName.localeCompare(right.playerName));
}

function careerOverlap(player: PlayerIdentity, bio: BioRecord): number {
  if (bio.fromYear === undefined && bio.toYear === undefined) return 0;
  const firstYear = bio.fromYear ?? Number.NEGATIVE_INFINITY;
  const lastYear = bio.toYear ?? Number.POSITIVE_INFINITY;
  return player.spanYears.filter((year) => year >= firstYear && year <= lastYear).length;
}

function resolveTargets(players: PlayerIdentity[], bios: BioRecord[]): {
  targets: DownloadTarget[];
  unresolved: MissingHeadshot[];
} {
  const biosByName = new Map<string, BioRecord[]>();
  for (const bio of bios) biosByName.set(bio.normalizedName, [...(biosByName.get(bio.normalizedName) ?? []), bio]);

  const targets: DownloadTarget[] = [];
  const unresolved: MissingHeadshot[] = [];
  for (const player of players) {
    const candidates = biosByName.get(player.normalizedName) ?? [];
    if (candidates.length === 0) {
      unresolved.push({ playerName: player.playerName, nbaId: null, reason: 'nba-id-not-found' });
      continue;
    }
    const ranked = [...candidates].sort((left, right) => careerOverlap(player, right) - careerOverlap(player, left));
    if (ranked.length > 1 && careerOverlap(player, ranked[0]) === careerOverlap(player, ranked[1])) {
      unresolved.push({ playerName: player.playerName, nbaId: null, reason: 'ambiguous-nba-id' });
      continue;
    }
    targets.push({ ...player, nbaId: ranked[0].nbaId });
  }
  return { targets, unresolved };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function validatePng(bytes: Uint8Array, contentType: string): string | null {
  const normalizedType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (normalizedType !== 'image/png' && normalizedType !== 'application/octet-stream') {
    return `unexpected-content-type:${normalizedType || 'missing'}`;
  }
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return 'invalid-png-signature';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkType !== 'IHDR' || view.getUint32(16) === 0 || view.getUint32(20) === 0) return 'invalid-png-header';
  return null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause && typeof cause === 'object') {
    const code = 'code' in cause ? String(cause.code) : '';
    const message = 'message' in cause ? String(cause.message) : '';
    if (code || message) return [code, message].filter(Boolean).join(':');
  }
  return error.message;
}

function parseOptions(args: string[]): CliOptions {
  const options: CliOptions = { concurrency: DEFAULT_CONCURRENCY, dryRun: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--limit') options.limit = Number.parseInt(args[++index] ?? '', 10);
    else if (arg === '--concurrency') options.concurrency = Number.parseInt(args[++index] ?? '', 10);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 32) {
    throw new Error('--concurrency must be an integer between 1 and 32');
  }
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  return options;
}

async function mapConcurrent<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await task(item);
    }
  }));
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const [bioCsv, playerJson] = await Promise.all([
    readFile(BIO_PATH, 'utf8'),
    readFile(PLAYER_DATABASE_PATH, 'utf8'),
  ]);
  const players = uniquePlayers(JSON.parse(playerJson) as DraftPlayerRecord[]);
  const { targets: allTargets, unresolved } = resolveTargets(players, parseBioDatabase(bioCsv));
  const targets = options.limit === undefined ? allTargets : allTargets.slice(0, options.limit);
  const manifest = Object.fromEntries(allTargets.map((target) => [target.playerName, target.nbaId]));

  if (options.dryRun) {
    console.log(`Dry run: ${players.length} players, ${allTargets.length} NBA IDs, ${unresolved.length} unresolved.`);
    for (const player of unresolved) console.warn(`Unresolved: ${player.playerName} — ${player.reason}`);
    console.log(`${targets.length} downloads would be considered; existing files would be skipped.`);
    return;
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const missing: MissingHeadshot[] = [...unresolved];
  for (const player of unresolved) console.warn(`Missing: ${player.playerName} — ${player.reason}`);
  const errors: MissingHeadshot[] = [];
  let cached = 0;
  let downloaded = 0;

  await mapConcurrent(targets, options.concurrency, async (target) => {
    const destination = path.join(OUTPUT_DIR, `${target.nbaId}.png`);
    if (await fileExists(destination)) {
      cached++;
      return;
    }

    const url = `${HEADSHOT_BASE_URL}/${target.nbaId}.png`;
    try {
      const response = await fetch(url, { headers: { Accept: 'image/png' } });
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const entry = {
          playerName: target.playerName,
          nbaId: target.nbaId,
          reason: response.status === 404 || response.status === 410 ? 'image-not-found' : 'http-error',
          httpStatus: response.status,
          contentType,
        };
        (entry.reason === 'image-not-found' ? missing : errors).push(entry);
        console.warn(`Missing: ${target.playerName} (${target.nbaId}) — HTTP ${response.status}`);
        return;
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const validationError = validatePng(bytes, contentType);
      if (validationError) {
        missing.push({ playerName: target.playerName, nbaId: target.nbaId, reason: validationError, contentType });
        console.warn(`Missing: ${target.playerName} (${target.nbaId}) — ${validationError}`);
        return;
      }

      try {
        await writeFile(destination, bytes, { flag: 'wx' });
        downloaded++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') cached++;
        else throw error;
      }
    } catch (error) {
      const reason = errorMessage(error);
      errors.push({ playerName: target.playerName, nbaId: target.nbaId, reason: `network-error:${reason}` });
      console.error(`Error: ${target.playerName} (${target.nbaId}) — ${reason}`);
    }
  });

  const sortEntries = (entries: MissingHeadshot[]): MissingHeadshot[] =>
    entries.sort((left, right) => left.playerName.localeCompare(right.playerName));
  const report = {
    generatedAt: new Date().toISOString(),
    playerDatabase: path.relative(process.cwd(), PLAYER_DATABASE_PATH).replaceAll('\\', '/'),
    nbaIdDatabase: path.relative(process.cwd(), BIO_PATH).replaceAll('\\', '/'),
    headshotManifest: path.relative(process.cwd(), MANIFEST_PATH).replaceAll('\\', '/'),
    sourceUrlTemplate: `${HEADSHOT_BASE_URL}/{nbaId}.png`,
    totals: {
      playersInDatabase: players.length,
      resolvedNbaIds: allTargets.length,
      consideredThisRun: targets.length,
      cached,
      downloaded,
      missing: missing.length,
      errors: errors.length,
    },
    missing: sortEntries(missing),
    errors: sortEntries(errors),
  };
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Headshots: ${downloaded} downloaded, ${cached} cached, ${missing.length} missing, ${errors.length} errors.`);
  console.log(`Report: ${REPORT_PATH}`);
  if (errors.length > 0) process.exitCode = 1;
}

await main();
