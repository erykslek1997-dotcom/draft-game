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

/**
 * 2026-09-17, user-reported live ("więcej sosu, coś jak share po zakończonym drafcie" — more
 * sauce, like the share after a finished draft): the "Challenge a friend" comparison popup's own
 * share action only ever copied a plain link. This gives it real visual payoff instead: both
 * sides' identity/score/tier side by side, a tug-of-war bar per metric, and the starting five
 * matched slot-for-slot with faces — a real downloadable PNG for the "you vs them" moment, not
 * just a link.
 * 2026-09-18: the single-team equivalent (`buildShareCardBlob`, a hand-coded `<canvas>` twin of
 * `ResultsScreen.tsx`'s `ShareModal`) was removed — it kept drifting out of sync with the modal's
 * real markup (a gradient-chip mismatch, then a roster-row overlap bug, both user-reported live)
 * since every layout change had to be re-implemented by hand in two places. Rebuilding it on real
 * DOM capture (e.g. `html-to-image`) instead of hand-drawn canvas is a real future fix, tracked
 * separately rather than re-patched here again.
 */
/** One rotation contributor's minutes at one slot — same shape as `ResultsScreen.tsx`'s own
 * `ChallengeRotationEntry`, duplicated rather than imported (that file already imports FROM this
 * one; a reverse import would make the two circularly dependent for a 3-field shape). */
export interface DuelRotationEntry {
  slot: string;
  name: string;
  minutes: number;
}

export interface DuelCardSide {
  name: string;
  overall: number;
  rank: number;
  fieldSize: number;
  /** 2026-09-17, user-reported live (screenshot comparing this card's old starters-only row
   * against the single-player hero's own bordered per-slot rotation cards): "rotacja by mogła być
   * tak jak tutaj" — every contributor at every slot, not just the starter, drawn the same
   * card-per-slot way. Replaces the earlier `starters`-only field entirely (this app has no real
   * users of the old shape yet — same session, see `ChallengeChallenger`'s own "no legacy format"
   * note). */
  rotation: DuelRotationEntry[];
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
  const hasRotation = you.rotation.length > 0 || friend.rotation.length > 0;

  // Grouped up front (not inside the draw loop) since each slot's CARD height depends on how many
  // contributors it has — the canvas height itself has to account for that before it's created.
  const youBySlot = new Map<string, DuelRotationEntry[]>(STARTER_SLOTS.map((s) => [s, []]));
  const friendBySlot = new Map<string, DuelRotationEntry[]>(STARTER_SLOTS.map((s) => [s, []]));
  you.rotation.forEach((e) => youBySlot.get(e.slot)?.push(e));
  friend.rotation.forEach((e) => friendBySlot.get(e.slot)?.push(e));
  youBySlot.forEach((list) => list.sort((a, b) => b.minutes - a.minutes));
  friendBySlot.forEach((list) => list.sort((a, b) => b.minutes - a.minutes));

  const ROTATION_HEADER_H = 40;
  const CARD_HEADER_H = 30;
  const CARD_ROW_H = 40;
  const CARD_PAD = 12;
  const CARD_GAP = 12;
  const slotCardHeights = STARTER_SLOTS.map((slot) => {
    const rows = Math.max(youBySlot.get(slot)!.length, friendBySlot.get(slot)!.length, 1);
    return CARD_HEADER_H + rows * CARD_ROW_H + CARD_PAD * 2;
  });
  const rotationBlockH = slotCardHeights.reduce((sum, h) => sum + h, 0) + CARD_GAP * (STARTER_SLOTS.length - 1);

  const panelTop = 150;
  const panelH = 200;
  const metricsTop = panelTop + panelH + 60;
  const rotationTop = hasScores ? metricsTop + 30 + 7 * 42 + 30 : metricsTop;
  const contentBottom = hasRotation ? rotationTop + ROTATION_HEADER_H + rotationBlockH : rotationTop;
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
      // 2026-09-17, user-reported live ("mamy np. 91/100 na skali, a wizualnie wygląda jakby skala
      // była do np. 200" — a 91/100 score visually reads as if the scale went up to ~200): this
      // used to fill each half by `mine/(mine+theirs)` — a relative-SHARE fraction, correct for two
      // numbers that sum to a whole (like a vote split), wrong for two independent 0-100 scores,
      // where it left roughly half the bar empty even for a near-maxed value. Every one of these 7
      // metrics is already a 0-100 score (see `ScoreChip`/`scoreBand` in ResultsScreen.tsx) — fill
      // length is now a direct percentage of that real, fixed scale instead.
      const leftW = (barHalf * mine) / 100;
      const rightW = (barHalf * theirs) / 100;
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

  // Rotation: one bordered card per slot (2026-09-17, user-reported live, comparing this section
  // against the single-player hero's own `results-hero-rotation` cards: "rotacja by mogła być tak
  // jak tutaj") — every contributor at that slot, not just the starter, each with real minutes.
  // "You"/"Friend" labelled once above the whole block (not per-card) since every card repeats the
  // same two-sided split; inside each card, that side's own contributors grow inward toward the
  // centred slot label, matching the identity panels' own side-by-side VS framing.
  if (hasRotation) {
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.inkFaint;
    ctx.font = '700 14px Arial, sans-serif';
    ctx.fillText('ROTATION', 56, rotationTop);
    ctx.font = '700 12px Arial, sans-serif';
    ctx.fillText('YOU', 74, rotationTop + 26);
    ctx.textAlign = 'right';
    ctx.fillText('YOUR FRIEND', W - 74, rotationTop + 26);
    ctx.textAlign = 'left';

    const cardX = 56;
    const cardW = W - 112;
    const radius = 15;
    const nameMaxW = cardW / 2 - 120;
    const images = await Promise.all(
      STARTER_SLOTS.map(async (slot) => {
        const youImgs = await Promise.all(youBySlot.get(slot)!.map((e) => loadImage(headshotUrl(e.name) ?? '')));
        const friendImgs = await Promise.all(friendBySlot.get(slot)!.map((e) => loadImage(headshotUrl(e.name) ?? '')));
        return { youImgs, friendImgs };
      }),
    );

    let cardY = rotationTop + ROTATION_HEADER_H;
    STARTER_SLOTS.forEach((slot, i) => {
      const youList = youBySlot.get(slot)!;
      const friendList = friendBySlot.get(slot)!;
      const rows = Math.max(youList.length, friendList.length, 1);
      const cardH = slotCardHeights[i];

      roundedRectPath(ctx, cardX, cardY, cardW, cardH, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.strokeStyle = PALETTE.line;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.inkFaint;
      ctx.font = '700 13px Arial, sans-serif';
      ctx.fillText(slot, W / 2, cardY + 20);

      const drawEntry = (entry: DuelRotationEntry | undefined, img: HTMLImageElement | null, r: number, mirrored: boolean) => {
        const rowCy = cardY + CARD_HEADER_H + CARD_PAD + r * CARD_ROW_H + CARD_ROW_H / 2;
        const cx = mirrored ? cardX + cardW - 20 - radius : cardX + 20 + radius;
        drawAvatarCircle(ctx, cx, rowCy, radius, img, entry ? initials(entry.name) : '');
        const textX = mirrored ? cx - radius - 12 : cx + radius + 12;
        ctx.textAlign = mirrored ? 'right' : 'left';
        ctx.fillStyle = PALETTE.ink;
        ctx.font = '600 15px Arial, sans-serif';
        ctx.fillText(fitText(ctx, entry?.name ?? '—', nameMaxW), textX, rowCy - 4);
        if (entry) {
          ctx.fillStyle = PALETTE.inkFaint;
          ctx.font = '500 12px Arial, sans-serif';
          ctx.fillText(`${Math.round(entry.minutes)}m`, textX, rowCy + 13);
        }
      };
      for (let r = 0; r < rows; r += 1) {
        drawEntry(youList[r], images[i].youImgs[r] ?? null, r, false);
        drawEntry(friendList[r], images[i].friendImgs[r] ?? null, r, true);
      }
      ctx.textAlign = 'left';

      cardY += cardH + CARD_GAP;
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
