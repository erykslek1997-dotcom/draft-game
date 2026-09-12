import { headshotUrl } from '../data/headshots';

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
