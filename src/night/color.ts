/** Contrast helpers for team colours on the night screens (AUDIT.md, "Readable team marks"). */

const DARK_INK = '#1E1C18';

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v.slice(0, 6);
  const [r, g, b] = (full.match(/../g) ?? ['00', '00', '00']).map((c) => {
    const s = Number.parseInt(c, 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** The text colour on a team band or mark: the franchise's own text colour, unless it reads below
 * 4.5:1 and dark ink reads better than white — then dark ink. Dark backgrounds keep theirs. */
export function bandInk(bg: string, fg = '#FFFFFF'): string {
  return contrast(bg, fg) < 4.5 && contrast(bg, DARK_INK) > contrast(bg, '#FFFFFF') ? DARK_INK : fg;
}
