import { headshotUrl } from '../data/headshots';
import { STARTER_SLOTS } from '../engine/positions';

/**
 * 2026-09-12, user-reported live ("tu powinna się generować grafika do zapisu jako png, i bardziej
 * szczegółowa"): the share modal (ResultsScreen.tsx's `ShareModal`) only ever offered "Copy as
 * text" — a plain clipboard string with no visual at all. This builds a real PNG "share card" —
 * same dark broadcast palette as the rest of the shell (App.css's `--at-*` tokens, hand-copied here
 * since a plain `<canvas>` draw can't read CSS custom properties through `ctx.fillStyle`) — with
 * the starting five's headshots on it, which is the "more detailed" half of the ask: the text copy
 * never had room for the roster at all, only the top-line score/odds/identity.
 *
 * Pure `<canvas>`, no library: this app has no chart/image dependency to reuse, and the shape here
 * (rounded rects, circular avatar clips, a handful of text runs) doesn't earn one.
 */

export interface ShareCardStarter {
  position: string;
  name: string;
}

/** 2026-09-12, user-reported live ("usuń copy as text, dodaj dodatkowe informacje jak roster,
 * rotacja itd") — the card used to stop at the starting five's faces; this carries the full
 * 9-man roster + real rotation minutes, the same numbers the Team/Rotation tabs already show. */
export interface ShareRosterRow {
  position: string;
  name: string;
  fga: number;
  minutes: number;
  isStarter: boolean;
}

export interface ShareCardData {
  teamName: string;
  rank: number;
  fieldSize: number;
  tier: { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 };
  overall: number;
  titleOdds: number | null;
  gap: number | null;
  topOverall: number | null;
  identity: string | null;
  starters: ShareCardStarter[];
  roster: ShareRosterRow[];
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th" — same rule `ResultsScreen.tsx`'s own local `ordinal`
 * uses; duplicated rather than imported, matching how that one is already duplicated into
 * QuickFive.tsx — small enough that a shared-utility module would be more ceremony than the copy. */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Hand-copied from App.css's `:root` block (`--at-*` tokens) — a `<canvas>` context can't resolve
 * CSS custom properties, so the card's palette is these same hex values, kept in sync manually.
 * 2026-09-12, code-review fix: `accent` had drifted to `#6f8ec2` — the real token is
 * `color-mix(in srgb, var(--at-brand-blue) 68%, white)` with `--at-brand-blue: #1D428A`, which
 * works out to `#657eaf` (checked by hand: R 29*.68+255*.32=101, G 66*.68+255*.32=126,
 * B 138*.68+255*.32=175 → 65/7e/af), not the value this had drifted to. Every other entry here
 * was re-checked against its real token the same way and still matches exactly. */
const PALETTE = {
  paper: '#0b0c0f',
  paperRaised: '#17181c',
  ink: '#f4f3ef',
  inkSoft: '#a9a8a3',
  inkFaint: '#6f6e6a',
  pill: '#1c2c4d',
  pillInk: '#d6e2f7',
  line: '#2a3348',
  accent: '#657eaf',
};

/** Same six finish tiers `results-hero-tier-t1..6` style in App.css — colors pre-mixed by hand
 * from those real `color-mix()` rules (a canvas context has no `color-mix`).
 * 2026-09-12, code-review fix: re-derived each one directly from App.css's actual rules rather
 * than trusting the existing values — tones 1-5's RGB already matched exactly (only their alpha
 * had drifted a few hundredths, corrected below); tone 6 ("Dynasty") had drifted to a completely
 * different, much darker color (`#3a4a63`) than the real `.results-hero-tier-t6` rule, which is
 * SOLID `var(--at-t6)` (`#76a1c4`), not a translucent one like the tiers below it. */
const TIER_COLORS: Record<1 | 2 | 3 | 4 | 5 | 6, { bg: string; fg: string }> = {
  1: { bg: 'rgba(215,83,105,0.24)', fg: '#e9a0ad' },
  2: { bg: 'rgba(215,83,105,0.24)', fg: '#e9a0ad' },
  3: { bg: 'rgba(197,143,60,0.26)', fg: '#e8b568' },
  4: { bg: 'rgba(92,135,168,0.34)', fg: '#ffffff' },
  5: { bg: 'rgba(118,161,196,0.40)', fg: '#ffffff' },
  6: { bg: '#76a1c4', fg: '#ffffff' },
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrinks (never wraps) a name to fit `maxWidth` at the context's current font — the starter
 * lane is a fixed column width and a wrapped second line would collide with the row below it. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

/** Builds the share card and resolves a PNG `Blob`, or `null` if canvas 2D isn't available. */
export async function buildShareCardBlob(data: ShareCardData): Promise<Blob | null> {
  const W = 1200;
  const H = 830;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Background: the same paper -> raised vertical gradient the app shell sits on, plus a soft
  // brand-accent glow in the corner so the card doesn't read as flat.
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, PALETTE.paperRaised);
  bgGrad.addColorStop(1, PALETTE.paper);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 60, 40, 20, W - 60, 40, 480);
  glow.addColorStop(0, 'rgba(111,142,194,0.30)');
  glow.addColorStop(1, 'rgba(111,142,194,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Eyebrow + team name.
  ctx.fillStyle = PALETTE.inkFaint;
  ctx.font = '700 20px Arial, sans-serif';
  ctx.fillText('ALL-TIME DRAFT', 56, 58);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = '800 52px Arial, sans-serif';
  ctx.fillText(fitText(ctx, data.teamName, 620), 56, 118);

  // Tier pill + rank, top-right.
  const tierColors = TIER_COLORS[data.tier.tone];
  const tierText = data.tier.label.toUpperCase();
  ctx.font = '700 20px Arial, sans-serif';
  const tierW = ctx.measureText(tierText).width + 36;
  roundedRectPath(ctx, W - 56 - tierW, 34, tierW, 38, 19);
  ctx.fillStyle = tierColors.bg;
  ctx.fill();
  ctx.fillStyle = tierColors.fg;
  ctx.textAlign = 'center';
  ctx.fillText(tierText, W - 56 - tierW / 2, 59);
  ctx.textAlign = 'right';
  ctx.fillStyle = PALETTE.ink;
  ctx.font = '700 28px Arial, sans-serif';
  ctx.fillText(`${ordinal(data.rank)} / ${data.fieldSize}`, W - 56, 108);
  ctx.textAlign = 'left';

  // Stat boxes: Final Power Ranking + (if present) Title odds — same two the share modal's own
  // text copy already leads with.
  const statY = 175;
  const statBoxW = 300;
  const stats: Array<{ label: string; value: string }> = [{ label: 'FINAL POWER RANKING', value: `${data.overall}` }];
  if (data.titleOdds !== null) {
    stats.push({ label: 'TITLE ODDS', value: `${(data.titleOdds * 100).toFixed(data.titleOdds >= 0.1 ? 0 : 1)}%` });
  }
  stats.forEach((stat, i) => {
    const x = 56 + i * (statBoxW + 20);
    roundedRectPath(ctx, x, statY, statBoxW, 110, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 15px Arial, sans-serif';
    ctx.fillText(stat.label, x + 20, statY + 34);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 44px Arial, sans-serif';
    ctx.fillText(stat.value, x + 20, statY + 85);
  });

  // Gap-to-#1 line, when the human isn't already #1 — same framing as the hero header.
  let cursorY = statY + 150;
  if (data.gap !== null) {
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.font = '500 20px Arial, sans-serif';
    const gapText = data.gap > 0
      ? `Overall #1 in the field: ${data.topOverall} — you're ${data.gap} back.`
      : 'You have the best Overall in the field.';
    ctx.fillText(fitText(ctx, gapText, W - 112), 56, cursorY);
    cursorY += 34;
  }

  // Identity chip.
  if (data.identity) {
    ctx.font = '700 18px Arial, sans-serif';
    const chipText = data.identity;
    const chipW = Math.min(W - 112, ctx.measureText(chipText).width + 32);
    roundedRectPath(ctx, 56, cursorY, chipW, 36, 18);
    ctx.fillStyle = PALETTE.pill;
    ctx.fill();
    ctx.fillStyle = PALETTE.pillInk;
    ctx.fillText(fitText(ctx, chipText, chipW - 32), 72, cursorY + 24);
    cursorY += 56;
  }

  // Starting five — headshots (or a monogram fallback, same as the app's own `Face` component),
  // position label above, name below. This row is the actual "more detailed" ask: the text-only
  // copy never showed the roster at all. `contentBottomY` tracks where THIS section actually ends
  // (cursorY itself is conditional on gap/identity rendering above, so the roster table below
  // needs its own real anchor, not a guessed constant).
  const starters = data.starters.slice(0, 5);
  let contentBottomY = cursorY;
  if (starters.length > 0) {
    const rowY = cursorY + 90;
    const laneW = (W - 112) / starters.length;
    const radius = 46;
    contentBottomY = rowY + radius + 26 + 30;
    const images = await Promise.all(starters.map((s) => {
      const src = headshotUrl(s.name);
      return src ? loadImage(src) : Promise.resolve(null);
    }));
    starters.forEach((starter, i) => {
      const cx = 56 + laneW * i + laneW / 2;
      const cy = rowY;

      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = '700 15px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(starter.position, cx, cy - radius - 16);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = PALETTE.pill;
      ctx.fill();
      const img = images[i];
      if (img) {
        ctx.clip();
        ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        ctx.fillStyle = PALETTE.pillInk;
        ctx.font = '700 26px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials(starter.name), cx, cy + 2);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, starter.name, laneW - 16), cx, cy + radius + 26);
      ctx.textAlign = 'left';
    });
  }

  // Full roster + rotation minutes — the actual "roster, rotacja itd" ask: the starters-with-faces
  // row above only ever showed 5 names, never a minute, so this is the first place the card shows
  // the other 4 roster spots and how the 48 minutes at each position are actually split.
  if (data.roster.length > 0) {
    const tableY = contentBottomY;
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 15px Arial, sans-serif';
    ctx.fillText('ROSTER & ROTATION', 56, tableY);

    const starterRows = data.roster.filter((r) => r.isStarter);
    const benchRows = data.roster.filter((r) => !r.isStarter);
    const colW = (W - 112) / 2;
    const rowH = 26;
    const drawRow = (row: ShareRosterRow, x: number, y: number) => {
      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = '700 13px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(row.position, x, y);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 15px Arial, sans-serif';
      ctx.fillText(fitText(ctx, row.name, colW - 150), x + 34, y);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '500 14px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(row.minutes)}m · ${row.fga.toFixed(1)} sh`, x + colW - 34, y);
      ctx.textAlign = 'left';
    };
    starterRows.forEach((row, i) => drawRow(row, 56, tableY + 30 + i * rowH));
    benchRows.forEach((row, i) => drawRow(row, 56 + colW, tableY + 30 + i * rowH));
  }

  // Footer.
  ctx.fillStyle = PALETTE.inkFaint;
  ctx.font = '500 17px Arial, sans-serif';
  ctx.fillText('🏀 Beat me? — All-Time Draft', 56, H - 32);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Triggers a browser download of the built card — a throwaway `<a download>` + object URL,
 * revoked right after the click (standard pattern; nothing here persists past this call). */
export async function downloadShareCard(data: ShareCardData, filename: string): Promise<boolean> {
  const blob = await buildShareCardBlob(data);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * 2026-09-17, user-reported live ("więcej sosu, coś jak share po zakończonym drafcie" — more
 * sauce, like the share after a finished draft): the "Challenge a friend" comparison popup's own
 * share action only ever copied a plain link — none of the visual payoff the single-team card
 * above gives a normal draft finish (gradient background, tier pill, headshots). This is that same
 * treatment applied to a head-to-head: both sides' identity/score/tier side by side, a tug-of-war
 * bar per metric, and the starting five matched slot-for-slot with faces — a real downloadable PNG
 * for the "you vs them" moment, not just a link.
 */
export interface DuelCardSide {
  name: string;
  overall: number;
  rank: number;
  fieldSize: number;
  starters: ShareCardStarter[];
  /** Missing on an older-format challenge link (see `ChallengeChallenger`'s own docstring) — the
   * metrics section is skipped entirely rather than showing one side's numbers against blanks. */
  scores?: { talent: number; benchDepth: number; offense: number; defense: number; spacing: number; fit: number; rotation: number };
}

export interface DuelCardData {
  you: DuelCardSide;
  friend: DuelCardSide;
}

/** Duplicated from `ResultsScreen.tsx`'s own `resultTierLabel` (not exported — same "small enough
 * that a shared-utility module would be more ceremony than the copy" call already made for
 * `ordinal`/`initials` in this file) so the duel card's tier pills read identically to the hero's
 * own tier badge for the same rank/fieldSize. */
function resultTierLabel(rank: number, fieldSize: number): { label: string; tone: 1 | 2 | 3 | 4 | 5 | 6 } {
  const pct = rank / fieldSize;
  if (rank === 1) return { label: 'Dynasty', tone: 6 };
  if (pct <= 0.2) return { label: 'Contender', tone: 5 };
  if (pct <= 0.4) return { label: 'Playoff Lock', tone: 4 };
  if (pct <= 0.6) return { label: 'Play-In Fight', tone: 3 };
  if (pct <= 0.85) return { label: 'Lottery Team', tone: 2 };
  if (rank < fieldSize) return { label: 'Full Rebuild', tone: 1 };
  return { label: 'Wooden Spoon', tone: 1 };
}

/** Same green "winner" accent the popup's own `.challenge-compare-*-winner` classes use. */
const WIN_GREEN = '#79c99a';
/** A second identity color for "your friend" wherever a row/bar needs to visually tell the two
 * sides apart even when neither is winning that particular row — the app has no existing token for
 * a two-party comparison, so this is picked to sit warm against `PALETTE.accent`'s cool blue. */
const FRIEND_ACCENT = '#c2896f';

function drawAvatarCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, img: HTMLImageElement | null, label: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = PALETTE.pill;
  ctx.fill();
  if (img) {
    ctx.clip();
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
  } else if (label) {
    ctx.fillStyle = PALETTE.pillInk;
    ctx.font = `700 ${Math.round(radius * 0.9)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 1);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

/** Builds the head-to-head duel card and resolves a PNG `Blob`, or `null` if canvas 2D isn't
 * available. Height is computed before the canvas is created (a canvas can't resize once drawn
 * to) so an older-format link missing `scores` or `starters` gets a shorter card instead of a
 * card with a blank gap where that section would have been. */
export async function buildDuelCardBlob(data: DuelCardData): Promise<Blob | null> {
  const { you, friend } = data;
  const W = 1200;
  const hasScores = Boolean(you.scores && friend.scores);
  const hasStarters = you.starters.length > 0 || friend.starters.length > 0;

  const panelTop = 150;
  const panelH = 200;
  const metricsTop = panelTop + panelH + 60;
  const startersTop = hasScores ? metricsTop + 30 + 7 * 42 + 20 : metricsTop;
  const contentBottom = hasStarters ? startersTop + 30 + STARTER_SLOTS.length * 52 + 20 : startersTop;
  const H = contentBottom + 60;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, PALETTE.paperRaised);
  bgGrad.addColorStop(1, PALETTE.paper);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 0, 20, W / 2, 0, 520);
  glow.addColorStop(0, 'rgba(111,142,194,0.26)');
  glow.addColorStop(1, 'rgba(111,142,194,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Header: same win/tie/loss framing as the popup's own headline text.
  const youWon = you.overall > friend.overall ? true : you.overall < friend.overall ? false : null;
  const headline = youWon === true ? '🏆 You win the duel' : youWon === false ? 'This one goes to your friend' : '🤝 It’s a tie';
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.inkFaint;
  ctx.font = '700 18px Arial, sans-serif';
  ctx.fillText('ALL-TIME DRAFT · CHALLENGE', W / 2, 50);
  ctx.fillStyle = PALETTE.ink;
  ctx.font = '800 44px Arial, sans-serif';
  ctx.fillText(headline, W / 2, 108);

  // Identity panels: same tier-pill language `buildShareCardBlob` uses, side by side.
  const panelW = 480;
  const leftX = 56;
  const rightX = W - 56 - panelW;
  const drawPanel = (x: number, label: string, side: DuelCardSide, isWinner: boolean) => {
    roundedRectPath(ctx, x, panelTop, panelW, panelH, 16);
    ctx.fillStyle = isWinner ? 'rgba(121,201,154,0.14)' : 'rgba(255,255,255,0.04)';
    ctx.fill();
    ctx.strokeStyle = isWinner ? WIN_GREEN : PALETTE.line;
    ctx.lineWidth = isWinner ? 2 : 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillText(label, x + 24, panelTop + 34);
    if (isWinner) {
      ctx.textAlign = 'right';
      ctx.fillStyle = WIN_GREEN;
      ctx.font = '800 13px Arial, sans-serif';
      ctx.fillText('WINNER', x + panelW - 24, panelTop + 34);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 28px Arial, sans-serif';
    ctx.fillText(fitText(ctx, side.name, panelW - 48), x + 24, panelTop + 70);
    ctx.font = '800 56px Arial, sans-serif';
    ctx.fillText(String(side.overall), x + 24, panelTop + 134);
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.font = '700 17px Arial, sans-serif';
    ctx.fillText(`${ordinal(side.rank)} / ${side.fieldSize}`, x + 24, panelTop + 164);

    const tier = resultTierLabel(side.rank, side.fieldSize);
    const tierColors = TIER_COLORS[tier.tone];
    const tierText = tier.label.toUpperCase();
    ctx.font = '700 14px Arial, sans-serif';
    const tierW = ctx.measureText(tierText).width + 28;
    roundedRectPath(ctx, x + panelW - 24 - tierW, panelTop + panelH - 54, tierW, 30, 15);
    ctx.fillStyle = tierColors.bg;
    ctx.fill();
    ctx.fillStyle = tierColors.fg;
    ctx.textAlign = 'center';
    ctx.fillText(tierText, x + panelW - 24 - tierW / 2, panelTop + panelH - 33);
    ctx.textAlign = 'left';
  };
  drawPanel(leftX, 'YOU', you, youWon === true);
  drawPanel(rightX, 'YOUR FRIEND', friend, youWon === false);
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.inkFaint;
  ctx.font = '800 26px Arial, sans-serif';
  ctx.fillText('VS', W / 2, panelTop + panelH / 2 + 9);

  // Metrics: a tug-of-war bar per row so the two values read as a comparison, not two labels.
  if (hasScores && you.scores && friend.scores) {
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillText('HEAD-TO-HEAD', W / 2, metricsTop);
    const rows: [string, number, number][] = [
      ['Talent', you.scores.talent, friend.scores.talent],
      ['Bench Depth', you.scores.benchDepth, friend.scores.benchDepth],
      ['Offense', you.scores.offense, friend.scores.offense],
      ['Defense', you.scores.defense, friend.scores.defense],
      ['Spacing', you.scores.spacing, friend.scores.spacing],
      ['Fit', you.scores.fit, friend.scores.fit],
      ['Rotation', you.scores.rotation, friend.scores.rotation],
    ];
    const barHalf = 340;
    const barH = 8;
    rows.forEach(([label, mine, theirs], i) => {
      const rowY = metricsTop + 30 + i * 42;
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = '700 12px Arial, sans-serif';
      ctx.fillText(label.toUpperCase(), W / 2, rowY);

      const barY = rowY + 10;
      roundedRectPath(ctx, W / 2 - barHalf, barY, barHalf * 2, barH, 4);
      ctx.fillStyle = PALETTE.line;
      ctx.fill();
      const total = mine + theirs || 1;
      const leftW = (barHalf * mine) / total;
      const rightW = (barHalf * theirs) / total;
      if (leftW > 0.5) {
        roundedRectPath(ctx, W / 2 - leftW, barY, leftW, barH, 4);
        ctx.fillStyle = mine >= theirs ? WIN_GREEN : PALETTE.accent;
        ctx.fill();
      }
      if (rightW > 0.5) {
        roundedRectPath(ctx, W / 2, barY, rightW, barH, 4);
        ctx.fillStyle = theirs > mine ? WIN_GREEN : FRIEND_ACCENT;
        ctx.fill();
      }

      ctx.font = '700 15px Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = mine > theirs ? WIN_GREEN : PALETTE.inkSoft;
      ctx.fillText(String(mine), W / 2 - barHalf - 14, rowY + 15);
      ctx.textAlign = 'left';
      ctx.fillStyle = theirs > mine ? WIN_GREEN : PALETTE.inkSoft;
      ctx.fillText(String(theirs), W / 2 + barHalf + 14, rowY + 15);
    });
  }

  // Starting five: matched slot-for-slot (not just listed in draft order), each side's face
  // growing inward toward the shared position label at center — a "fight card" layout, the same
  // instinct behind the identity panels' own side-by-side VS framing.
  if (hasStarters) {
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillText('STARTING FIVE', 56, startersTop);

    const youBySlot = new Map(you.starters.map((s) => [s.position, s]));
    const friendBySlot = new Map(friend.starters.map((s) => [s.position, s]));
    const radius = 20;
    const nameMaxW = 360;
    const images = await Promise.all(
      STARTER_SLOTS.map(async (slot) => {
        const y = youBySlot.get(slot);
        const f = friendBySlot.get(slot);
        const [youImg, friendImg] = await Promise.all([
          y ? loadImage(headshotUrl(y.name) ?? '') : Promise.resolve(null),
          f ? loadImage(headshotUrl(f.name) ?? '') : Promise.resolve(null),
        ]);
        return { youImg, friendImg };
      }),
    );
    STARTER_SLOTS.forEach((slot, i) => {
      const rowY = startersTop + 30 + i * 52 + 26;
      const y = youBySlot.get(slot);
      const f = friendBySlot.get(slot);

      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = '700 13px Arial, sans-serif';
      ctx.fillText(slot, W / 2, rowY + 5);

      const youCx = 56 + radius;
      drawAvatarCircle(ctx, youCx, rowY, radius, images[i].youImg, y ? initials(y.name) : '');
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px Arial, sans-serif';
      ctx.fillText(fitText(ctx, y?.name ?? '—', nameMaxW), youCx + radius + 16, rowY + 6);

      const friendCx = W - 56 - radius;
      drawAvatarCircle(ctx, friendCx, rowY, radius, images[i].friendImg, f ? initials(f.name) : '');
      ctx.textAlign = 'right';
      ctx.fillText(fitText(ctx, f?.name ?? '—', nameMaxW), friendCx - radius - 16, rowY + 6);
      ctx.textAlign = 'left';
    });
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = PALETTE.inkFaint;
  ctx.font = '500 16px Arial, sans-serif';
  ctx.fillText('🏀 Same board, same AI — All-Time Draft', 56, H - 30);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

/** Triggers a browser download of the built duel card — same throwaway `<a download>` + object
 * URL pattern as `downloadShareCard`. */
export async function downloadDuelCard(data: DuelCardData, filename: string): Promise<boolean> {
  const blob = await buildDuelCardBlob(data);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}
