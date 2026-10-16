/**
 * 2026-10-16, daily challenges for the drafts (TODO.md 3.4, mockups `docs/mockups/daily-drafts.html`).
 * One day = one draft for everyone: the same seed (draft slot, rivals, AI), a cap for every team
 * and one rule for the player only. Read off the date alone — no engine — so the menu can show the
 * rules on the mode card without loading the game.
 *
 * The user's decisions (2026-10-15/16): the cap is the same for every team, the CPU's too; bans and
 * other rules are the player's only; rules show on the card; the same draft for everyone, one try.
 * Mini caps 65–80 (below 65 the CPU starts leaving positions empty — the daily AI tests in TODO).
 */
export type DailyDraftMode = 'mini' | 'alltime';

export type DailyRule =
  | { kind: 'open' }
  /** No one who ever played for this franchise. */
  | { kind: 'team'; code: string; name: string }
  /** No one whose window touches this decade (seasons ending in it). */
  | { kind: 'era'; decade: number }
  /** At most this many MVP-tier players (MVP, Greatest peak, GOAT). */
  | { kind: 'stars'; max: number };

export interface DailyDraftDay {
  mode: DailyDraftMode;
  /** Local date, YYYY-MM-DD. */
  day: string;
  /** The draft's seed — the same for everyone today. */
  seed: number;
  cap: number;
  rule: DailyRule;
  /** "No Lakers today". */
  title: string;
  /** "No one who ever played for the Lakers". */
  ruleLine: string;
  /** "Lakers · not today" — on a player you can't take. */
  ruleTag: string;
  /** Another day's draft rerolled from the menu while testing (`DAILY_REPLAY_FOR_TESTING`): played
   * like the real one, but its result, streak and save are never kept. */
  testing?: boolean;
}

/** The franchises with the most top players in the pool (TAL 75+, 12–24 each) — a block that bites. */
const BLOCK_TEAMS: { code: string; name: string }[] = [
  { code: 'LAL', name: 'Lakers' },
  { code: 'NYK', name: 'Knicks' },
  { code: 'BOS', name: 'Celtics' },
  { code: 'HOU', name: 'Rockets' },
  { code: 'MIA', name: 'Heat' },
  { code: 'GSW', name: 'Warriors' },
  { code: 'PHI', name: '76ers' },
  { code: 'PHX', name: 'Suns' },
  { code: 'DAL', name: 'Mavericks' },
  { code: 'MIL', name: 'Bucks' },
  { code: 'DEN', name: 'Nuggets' },
  { code: 'DET', name: 'Pistons' },
  { code: 'POR', name: 'Trail Blazers' },
  { code: 'CHI', name: 'Bulls' },
  { code: 'SAS', name: 'Spurs' },
];
const BLOCK_DECADES = [1980, 1990, 2000, 2010, 2020];
const CAPS: Record<DailyDraftMode, number[]> = { mini: [65, 70, 75, 80], alltime: [90, 95, 100.9, 105, 110] };

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFor(text: string): () => number {
  let a = hash(text) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

const decadeLabel = (decade: number) => (decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`);

export function dailyDraftDay(mode: DailyDraftMode, day: string): DailyDraftDay {
  const rng = rngFor(`daily-draft:${mode}:${day}`);
  const seed = hash(`daily-draft-seed:${mode}:${day}`);
  const caps = CAPS[mode];
  const cap = caps[Math.floor(rng() * caps.length)];
  const roll = rng();
  let rule: DailyRule;
  // Sunday is an open day: just the draft and the day's cap.
  if (weekday(day) === 0) rule = { kind: 'open' };
  else if (roll < 0.5) rule = { kind: 'team', ...BLOCK_TEAMS[Math.floor(rng() * BLOCK_TEAMS.length)] };
  else if (roll < 0.75) rule = { kind: 'era', decade: BLOCK_DECADES[Math.floor(rng() * BLOCK_DECADES.length)] };
  else rule = { kind: 'stars', max: 1 };
  return { mode, day, seed, cap, rule, ...dailyRuleWords(rule) };
}

export function dailyRuleWords(rule: DailyRule): Pick<DailyDraftDay, 'title' | 'ruleLine' | 'ruleTag'> {
  switch (rule.kind) {
    case 'team':
      return { title: `No ${rule.name} today`, ruleLine: `No one who ever played for the ${rule.name}`, ruleTag: `${rule.name} · not today` };
    case 'era':
      return { title: `No ${decadeLabel(rule.decade)} today`, ruleLine: `No one who played in the ${rule.decade}s`, ruleTag: `${decadeLabel(rule.decade)} · not today` };
    case 'stars':
      return { title: 'One superstar, tops', ruleLine: 'At most one MVP-tier player', ruleTag: 'One MVP-tier already' };
    default:
      return { title: 'Open day', ruleLine: 'No extra rule — just the draft', ruleTag: '' };
  }
}

/** "Thursday · Oct 16". */
export function dailyDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${date.toLocaleDateString('en-US', { weekday: 'long' })} · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
