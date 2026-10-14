import { franchiseByName, type FranchiseLogo } from '../data/franchises';

/**
 * 2026-10-14, the franchise logos (data/franchises.ts): a crest shape, a field pattern and a symbol
 * on a 100x100 viewBox, built as SVG strings from these few parts — the whole pool is ~30 KB of
 * code and no image files. TeamLogo.tsx wraps the markup in an <svg>.
 */
type SymbolDraw = (b: string, a: string) => string;

const f = (n: number) => +n.toFixed(2);

const SHAPES: Record<FranchiseLogo['shape'], string> = {
  shield: 'M50 4 L90 14 V46 C90 72 72 88 50 97 C28 88 10 72 10 46 V14 Z',
  circle: 'M4 50 A46 46 0 1 0 96 50 A46 46 0 1 0 4 50 Z',
  hexagon: 'M50 3 L91 26.5 V73.5 L50 97 L9 73.5 V26.5 Z',
  diamond: 'M50 2 L98 50 L50 98 L2 50 Z',
  octagon: 'M31 4 H69 L96 31 V69 L69 96 H31 L4 69 V31 Z',
  badge: 'M8 6 H92 V58 L50 96 L8 58 Z',
  square: 'M22 5 H78 Q95 5 95 22 V78 Q95 95 78 95 H22 Q5 95 5 78 V22 Q5 5 22 5 Z',
  crest: 'M10 8 H30 L50 16 L70 8 H90 V50 C90 74 72 89 50 97 C28 89 10 74 10 50 Z',
};
/** Where the symbol sits and how big, per shape (diamond and badge have less room). */
const SYMBOL_FIT: Record<FranchiseLogo['shape'], { s: number; y: number }> = {
  shield: { s: 0.74, y: -1 }, circle: { s: 0.78, y: 0 }, hexagon: { s: 0.74, y: 0 }, diamond: { s: 0.6, y: 0 },
  octagon: { s: 0.8, y: 0 }, badge: { s: 0.68, y: -6 }, square: { s: 0.8, y: 0 }, crest: { s: 0.7, y: 2 },
};

const PATTERNS: Record<FranchiseLogo['pattern'], (c: string) => string> = {
  solid: () => '',
  split: (c) => `<rect x="50" y="0" width="50" height="100" fill="${c}"/>`,
  band: (c) => `<path d="M-10 92 L92 -10" stroke="${c}" stroke-width="24"/>`,
  base: (c) => `<rect x="0" y="66" width="100" height="34" fill="${c}"/>`,
  chief: (c) => `<rect x="0" y="0" width="100" height="32" fill="${c}"/>`,
  chevron: (c) => `<path d="M0 74 L50 50 L100 74 V100 H0 Z" fill="${c}"/>`,
  ring: (c) => `<circle cx="50" cy="50" r="31" fill="none" stroke="${c}" stroke-width="7"/>`,
  quarters: (c) => `<rect x="50" y="0" width="50" height="50" fill="${c}"/><rect x="0" y="50" width="50" height="50" fill="${c}"/>`,
};

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [f(cx + r * Math.cos(a)), f(cy + r * Math.sin(a))];
}
function starPath(cx: number, cy: number, R: number, r: number, n = 5): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) pts.push(polar(cx, cy, i % 2 ? r : R, (180 / n) * i));
  return `M${pts.map((p) => p.join(' ')).join(' L')} Z`;
}
function gearPath(cx: number, cy: number, R: number, r: number, teeth: number): string {
  const pts: [number, number][] = [];
  const step = 360 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    pts.push(polar(cx, cy, r, a - step * 0.32), polar(cx, cy, R, a - step * 0.2), polar(cx, cy, R, a + step * 0.2), polar(cx, cy, r, a + step * 0.32));
  }
  return `M${pts.map((p) => p.join(' ')).join(' L')} Z`;
}
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
function crescent(cx: number, cy: number, R: number, ox: number, oy: number, r: number): string {
  // Big circle minus an offset circle, as one path through their two intersection points.
  const dx = ox - cx, dy = oy - cy, d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d), h = Math.sqrt(R * R - a * a);
  const mx = cx + (a * dx) / d, my = cy + (a * dy) / d;
  const p1 = [f(mx + (h * dy) / d), f(my - (h * dx) / d)], p2 = [f(mx - (h * dy) / d), f(my + (h * dx) / d)];
  return `M${p1.join(' ')} A${R} ${R} 0 1 0 ${p2.join(' ')} A${r} ${r} 0 0 1 ${p1.join(' ')} Z`;
}

/** Plain symbols for names that aren't an animal (and spares for future teams). Each draws in the
 * accent and may cut details in `b`, the field colour. Box ~10..90. */
const GENERIC_SYMBOLS: Record<string, SymbolDraw> = {
  bolt: () => `<path d="M58 10 L26 56 H46 L38 90 L74 40 H54 L64 10 Z"/>`,
  star: () => `<path d="${starPath(50, 53, 40, 16)}"/>`,
  crown: () => `<path d="M18 70 L13 30 L34 48 L50 20 L66 48 L87 30 L82 70 Z"/><rect x="18" y="75" width="64" height="9" rx="2"/><circle cx="13" cy="28" r="5"/><circle cx="50" cy="18" r="5"/><circle cx="87" cy="28" r="5"/>`,
  flame: () => `<path fill-rule="evenodd" d="M50 8 C60 28 80 38 78 62 C76 82 62 92 50 92 C36 92 22 82 22 62 C22 46 33 40 36 26 C43 37 44 46 48 51 C53 38 45 24 50 8 Z M50 56 C57 65 62 71 60 79 C58 86 42 86 40 79 C38 71 44 65 50 56 Z"/>`,
  waves: () => `<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M14 32 Q23 22 32 32 T50 32 T68 32 T86 32"/><path d="M14 52 Q23 42 32 52 T50 52 T68 52 T86 52"/><path d="M14 72 Q23 62 32 72 T50 72 T68 72 T86 72"/></g>`,
  mountain: (b: string) => `<path d="M6 84 L38 26 L52 50 L64 34 L94 84 Z"/><path d="M38 26 L47 42 L42 39 L38 45 L33 39 L29 42 Z" fill="${b}" opacity=".35"/>`,
  sun: () => {
    let rays = '';
    for (let i = 0; i < 12; i++) {
      const [x1, y1] = polar(50, 50, 24, i * 30 - 7), [x2, y2] = polar(50, 50, 42, i * 30), [x3, y3] = polar(50, 50, 24, i * 30 + 7);
      rays += `M${x1} ${y1} L${x2} ${y2} L${x3} ${y3} Z `;
    }
    return `<path d="${rays}"/><circle cx="50" cy="50" r="19"/>`;
  },
  moon: () => `<path d="${crescent(50, 50, 38, 66, 38, 32)}"/><path d="${starPath(72, 66, 9, 3.6)}"/>`,
  paw: () => `<ellipse cx="50" cy="66" rx="20" ry="17"/><ellipse cx="24" cy="44" rx="8" ry="10" transform="rotate(-20 24 44)"/><ellipse cx="40" cy="28" rx="8" ry="11" transform="rotate(-6 40 28)"/><ellipse cx="60" cy="28" rx="8" ry="11" transform="rotate(6 60 28)"/><ellipse cx="76" cy="44" rx="8" ry="10" transform="rotate(20 76 44)"/>`,
  wing: () => `<path d="M10 34 C28 22 56 18 92 22 C88 28 82 31 72 32 C82 34 86 38 88 43 C78 45 68 44 60 43 C67 47 71 52 71 59 C60 59 51 55 44 50 C46 59 45 68 40 78 C28 66 16 52 10 34 Z"/>`,
  anchor: () => `<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><circle cx="50" cy="20" r="8"/><path d="M50 28 V84"/><path d="M34 40 H66"/><path d="M18 58 Q20 84 50 84 Q80 84 82 58"/></g><path d="M10 62 L18 50 L26 62 Z"/><path d="M74 62 L82 50 L90 62 Z"/>`,
  claw: () => [0, 19, 38].map((dx: number) => `<path d="M${16 + dx} 14 C${34 + dx} 36 ${36 + dx} 62 ${26 + dx} 88 C${50 + dx} 66 ${48 + dx} 34 ${16 + dx} 14 Z"/>`).join(''),
  horns: (b: string) => `<path d="M50 80 C39 80 33 71 33 62 C22 61 10 52 8 28 C17 40 28 46 39 46 C44 41 56 41 61 46 C72 46 83 40 92 28 C90 52 78 61 67 62 C67 71 61 80 50 80 Z"/><circle cx="42" cy="58" r="3.5" fill="${b}"/><circle cx="58" cy="58" r="3.5" fill="${b}"/>`,
  antlers: () => `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M44 60 C40 44 30 36 16 30"/><path d="M33 40 L30 20"/><path d="M24 34 L12 18"/><path d="M40 50 L24 52"/><path d="M56 60 C60 44 70 36 84 30"/><path d="M67 40 L70 20"/><path d="M76 34 L88 18"/><path d="M60 50 L76 52"/></g><path d="M38 56 H62 L56 88 H44 Z"/>`,
  feather: (b: string) => `<path d="M76 10 C44 18 26 48 30 76 L22 90 L27 92 L35 80 C64 78 82 46 76 10 Z"/><path d="M33 78 C44 56 56 36 70 20" fill="none" stroke="${b}" stroke-width="3" stroke-linecap="round"/><path d="M44 60 L60 58 M50 48 L66 44" stroke="${b}" stroke-width="2.5" stroke-linecap="round"/>`,
  fang: () => `<path d="M24 16 C24 48 30 70 42 90 C44 68 46 42 46 16 Z"/><path d="M76 16 C76 48 70 70 58 90 C56 68 54 42 54 16 Z"/><rect x="18" y="10" width="64" height="10" rx="5"/>`,
  tornado: () => `<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M14 18 H86"/><path d="M22 32 H78"/><path d="M30 46 H72"/><path d="M38 60 H66"/><path d="M46 74 H62"/><path d="M50 88 H56"/></g>`,
  gear: () => `<path fill-rule="evenodd" d="${gearPath(50, 50, 42, 32, 10)} ${circ(50, 50, 13)}"/>`,
  pickaxe: () => `<path d="M10 40 Q50 4 90 40 Q50 22 10 40 Z"/><rect x="45" y="24" width="10" height="66" rx="4"/>`,
  trident: () => `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M50 90 V22"/><path d="M26 28 V44 Q26 56 50 56 Q74 56 74 44 V28"/></g><path d="M50 6 L59 24 H41 Z"/><path d="M26 12 L34 30 H18 Z"/><path d="M74 12 L82 30 H66 Z"/>`,
  fin: () => `<path d="M26 72 C38 50 46 28 74 12 C66 34 66 54 78 72 Z"/><path d="M8 82 Q17 74 26 82 T44 82 T62 82 T80 82 T98 82" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`,
  snowflake: () => {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const a = i * 60;
      const [x, y] = polar(50, 50, 40, a), [m1x, m1y] = polar(50, 50, 24, a);
      const [l1x, l1y] = polar(m1x, m1y, 12, a - 50), [r1x, r1y] = polar(m1x, m1y, 12, a + 50);
      d += `M50 50 L${x} ${y} M${m1x} ${m1y} L${l1x} ${l1y} M${m1x} ${m1y} L${r1x} ${r1y} `;
    }
    return `<path d="${d}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="50" r="8"/>`;
  },
  pine: () => `<path d="M50 8 L70 36 H60 L76 58 H65 L84 80 H16 L35 58 H24 L40 36 H30 Z"/><rect x="44" y="80" width="12" height="12" rx="2"/>`,
  gem: (b: string) => `<path d="M28 20 H72 L90 40 L50 88 L10 40 Z"/><path d="M10 40 H90 M28 20 L38 40 L50 20 L62 40 L72 20 M38 40 L50 88 L62 40" fill="none" stroke="${b}" stroke-width="3" stroke-linejoin="round"/>`,
  eye: () => `<path fill-rule="evenodd" d="M6 50 Q50 6 94 50 Q50 94 6 50 Z ${circ(50, 50, 18)}"/><circle cx="50" cy="50" r="9"/>`,
  comet: () => `<circle cx="66" cy="34" r="16"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M54 46 L16 84" stroke-width="9"/><path d="M50 34 L18 60" stroke-width="6"/><path d="M66 50 L40 86" stroke-width="6"/></g>`,
  cactus: () => `<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M50 90 V16" stroke-width="15"/><path d="M50 62 H32 V38" stroke-width="11"/><path d="M50 52 H68 V26" stroke-width="11"/></g><rect x="22" y="86" width="56" height="6" rx="3"/>`,
  anvil: () => `<path d="M10 28 H76 C84 28 90 32 92 40 C82 40 76 42 72 47 L64 53 V66 H76 V80 H24 V66 H36 V53 C24 49 14 40 10 28 Z"/>`,
  snake: (b: string) => `<path d="M18 84 C40 94 66 84 60 66 C55 52 30 58 30 42 C30 26 50 20 62 26" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/><path d="M58 18 L80 16 L86 28 L70 38 Z"/><circle cx="74" cy="24" r="2.6" fill="${b}"/><path d="M85 22 L94 18 M85 22 L94 26" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,
};

const mirror = (half: string) => `${half}<g transform="translate(100 0) scale(-1 1)">${half}</g>`;
const facet = (b: string, d: string, o = 0.22) => `<path d="${d}" fill="${b}" opacity="${o}"/>`;
const line = (c: string, d: string, w = 3) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

function petals(n: number, r: number, rx: number, ry: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += `<ellipse cx="50" cy="${50 - r}" rx="${rx}" ry="${ry}" transform="rotate(${(360 / n) * i} 50 50)"/>`;
  return out;
}

/** Mascots: flat, geometric animals (and literal objects) in the accent, details cut in the field
 * colour. Front-facing heads draw the left half and mirror it, so they stay symmetric and short. */
const MASCOTS: Record<string, SymbolDraw> = {
  coyote: (b: string) => mirror(`<path d="M50 34 L40 30 L22 4 L14 40 L8 58 L28 72 L40 86 L50 92 Z"/>${facet(b, 'M38 30 L24 12 L20 36 Z', 0.35)}${facet(b, 'M14 40 L8 58 L28 72 L30 54 Z')}<path d="M27 52 L41 55 L37 60 Z" fill="${b}"/>`) + `<path d="M44 84 H56 L50 92 Z" fill="${b}"/>`,
  owl: (b: string, a: string) => mirror(`<path d="M50 30 L30 24 L16 6 L14 34 C8 48 10 66 20 78 C30 88 40 92 50 92 Z"/><circle cx="34" cy="48" r="13" fill="${b}"/><circle cx="34" cy="48" r="6" fill="${a}"/>${facet(b, 'M20 78 C30 88 40 92 50 92 L50 74 C40 74 30 72 20 78 Z')}`) + `<path d="M44 56 H56 L50 70 Z" fill="${b}"/>`,
  raccoon: (b: string, a: string) => mirror(`<path d="M50 28 L34 26 L22 10 L14 30 L6 50 L2 60 L12 62 L8 70 L28 80 L40 88 L50 90 Z"/><path d="M16 30 L22 16 L30 27 Z" fill="${b}" opacity=".35"/><path d="M50 44 L36 40 L10 50 L18 60 L34 62 L44 56 L50 56 Z" fill="${b}"/><circle cx="30" cy="52" r="4" fill="${a}"/>`) + `<path d="M44 80 H56 L50 88 Z" fill="${b}"/>`,
  moose: (b: string) => mirror(`<path d="M42 40 L30 36 L18 38 L8 30 L4 14 L10 20 L12 8 L18 18 L22 6 L26 18 L32 10 L32 24 L40 30 Z"/><path d="M50 36 L40 36 L34 44 L30 52 L38 56 L38 74 C38 84 42 92 50 92 Z"/><path d="M38 46 L32 50 L38 52 Z" fill="${b}"/>`) + `<ellipse cx="44" cy="84" rx="2.4" ry="3.5" fill="${b}"/><ellipse cx="56" cy="84" rx="2.4" ry="3.5" fill="${b}"/>`,
  rooster: (b: string) => `<path d="M40 26 C36 14 44 8 50 16 C52 6 62 6 63 16 C68 8 78 12 72 24 C74 28 74 32 72 36 L88 42 L72 48 C72 54 70 58 66 60 C70 68 70 80 74 92 H34 C38 74 32 54 40 26 Z"/><path d="M64 58 C72 60 74 70 66 76 C60 72 60 64 64 58 Z"/><circle cx="60" cy="38" r="4" fill="${b}"/>${facet(b, 'M40 66 C50 60 64 66 66 80 C56 84 44 80 40 66 Z', 0.3)}${facet(b, 'M40 26 C36 14 44 8 50 16 C52 6 62 6 63 16 C68 8 78 12 72 24 C60 20 48 22 40 26 Z', 0.18)}`,
  walrus: (b: string) => mirror(`<path d="M50 20 C30 20 12 30 10 46 C8 56 14 62 22 64 L50 64 Z"/><ellipse cx="37" cy="58" rx="17" ry="13"/><path d="M30 66 L33 97 L42 68 Z"/><circle cx="30" cy="38" r="3.2" fill="${b}"/>${line(b, 'M24 33 L35 35', 2.5)}${line(b, 'M30 56 L18 52 M30 60 L16 60 M31 64 L19 68', 1.8)}`) + `<ellipse cx="50" cy="47" rx="6" ry="4" fill="${b}"/>${line(b, 'M50 51 V66', 2)}`,
  yeti: (b: string, a: string) => mirror(`<path d="M50 6 L42 12 L36 4 L32 14 L24 8 L22 20 L12 18 L16 30 L4 34 L14 44 L4 52 L16 58 L8 68 L22 72 L18 84 L32 82 L36 94 L44 86 L50 94 Z"/><path d="M50 30 C40 30 26 34 26 50 C26 64 38 72 50 72 Z" fill="${b}"/><circle cx="39" cy="47" r="4.5" fill="${a}"/>${line(a, 'M30 38 L45 42', 4)}<path d="M41 61 L45 61 L43 67 Z" fill="${a}"/>`) + line(a, 'M38 60 Q50 66 62 60', 3.5),
  jackrabbit: (b: string) => mirror(`<path d="M45 40 C42 26 38 10 30 2 C22 10 24 28 33 42 Z"/><path d="M41 34 C38 24 35 14 31 9 C27 15 28 26 34 36 Z" fill="${b}" opacity=".35"/><path d="M50 34 C36 34 22 44 22 60 C22 76 36 88 50 88 Z"/><ellipse cx="37" cy="58" rx="4" ry="5" fill="${b}"/>${line(b, 'M41 74 L24 72 M41 78 L26 82', 2.2)}`) + `<path d="M45 69 H55 L50 75 Z" fill="${b}"/>`,
  jackalope: (b: string) => mirror(`${line('currentColor', 'M44 36 L38 10 M39 18 L28 10 M41 26 L48 14', 6)}<path d="M36 46 C26 36 12 32 4 34 C10 46 24 52 36 52 Z"/><path d="M50 36 C38 36 26 46 26 62 C26 78 38 90 50 90 Z"/><ellipse cx="39" cy="61" rx="4" ry="5" fill="${b}"/>${line(b, 'M42 77 L28 76', 2.2)}`) + `<path d="M45 72 H55 L50 78 Z" fill="${b}"/>`,
  mole: (b: string) => mirror(`<path d="M50 14 C36 14 22 24 20 40 C18 52 26 60 34 66 L46 84 L50 86 Z"/><circle cx="35" cy="42" r="2.6" fill="${b}"/>${facet(b, 'M26 56 C34 54 42 60 46 72 L36 62 Z', 0.3)}<path d="M22 64 C10 66 6 76 8 88 L13 80 L15 92 L20 82 L24 94 L27 84 L33 90 C35 78 31 68 22 64 Z"/>`) + `<path d="M43 80 C43 76 57 76 57 80 C57 86 53 90 50 90 C47 90 43 86 43 80 Z" fill="${b}"/>`,
  manatee: (b: string) => `<path d="M8 54 C8 40 24 32 44 34 C62 36 76 44 84 54 L96 44 L95 70 L84 63 C76 72 60 76 40 74 C22 72 8 68 8 54 Z"/><path d="M40 70 C38 80 46 88 54 86 C52 80 50 74 48 70 Z"/><circle cx="20" cy="48" r="2.8" fill="${b}"/><circle cx="12" cy="57" r="1.6" fill="${b}"/><circle cx="16" cy="60" r="1.6" fill="${b}"/>${facet(b, 'M30 66 C46 72 66 70 80 60 C70 70 56 74 40 74 C34 74 30 70 30 66 Z')}`,
  armadillo: (b: string) => `<path d="M20 68 C20 42 36 28 54 28 C72 28 86 42 86 68 Z"/><path d="M22 60 L4 68 L22 72 Z"/><path d="M18 54 L14 44 L23 51 Z"/><path d="M84 62 C92 64 96 70 98 80 C92 76 88 72 82 70 Z"/><rect x="28" y="66" width="9" height="12" rx="2"/><rect x="68" y="66" width="9" height="12" rx="2"/>${line(b, 'M38 32 Q33 50 35 68 M47 29 Q44 50 45 68 M56 28 Q56 50 56 68 M65 29 Q68 50 66 68 M74 33 Q79 50 77 68', 3)}<circle cx="14" cy="64" r="1.8" fill="${b}"/>`,
  narwhal: (b: string) => `<path d="M10 62 C10 48 24 40 42 42 C58 44 72 52 80 58 L94 48 L93 70 L82 64 C72 74 56 78 40 76 C22 74 10 72 10 62 Z"/><path d="M13 54 L2 14 L19 52 Z"/>${line(b, 'M10 44 L13 42 M8 36 L11 34 M6 28 L9 26', 1.8)}<circle cx="24" cy="58" r="2.8" fill="${b}"/><path d="M42 72 C40 80 46 86 54 86 C52 80 50 76 48 72 Z"/><circle cx="48" cy="50" r="2" fill="${b}"/><circle cx="58" cy="54" r="2.4" fill="${b}"/><circle cx="66" cy="58" r="1.8" fill="${b}"/>`,
  ibex: (b: string) => mirror(`${line('currentColor', 'M43 32 C38 12 22 4 12 12 C4 20 8 34 18 38', 9)}${line(b, 'M36 16 L32 22 M28 10 L27 17 M19 9 L20 16', 2)}<path d="M50 30 L40 30 L33 40 L37 58 L40 80 C42 88 46 92 50 92 Z"/><path d="M34 42 L18 46 L34 50 Z"/><path d="M40 50 L34 52 L40 55 Z" fill="${b}"/>`) + `<path d="M44 88 L50 99 L56 88 Z"/><path d="M46 82 H54 L50 86 Z" fill="${b}"/>`,
  bison: (b: string) => mirror(`<path d="M50 12 L43 17 L37 10 L31 19 L23 14 L21 26 L12 32 L14 44 L9 52 L17 60 L22 72 L28 84 L36 90 L42 88 L46 97 L50 93 Z"/><path d="M22 32 C8 32 1 22 3 6 C9 17 16 22 28 25 Z"/>${facet(b, 'M50 12 L43 17 L37 10 L31 19 L23 14 L21 26 L12 32 C24 30 38 30 50 34 Z', 0.3)}<path d="M38 48 L29 50 L37 54 Z" fill="${b}"/>${facet(b, 'M14 44 L9 52 L17 60 L22 72 L28 84 C24 70 22 56 24 44 Z', 0.25)}<ellipse cx="44" cy="76" rx="2.2" ry="3.2" fill="${b}"/>`),
  yak: (b: string) => mirror(`<path d="M50 28 L34 30 L22 42 L16 70 L10 94 L22 86 L26 96 L32 84 L38 92 L42 80 L50 86 Z"/><path d="M34 34 C20 34 8 26 4 10 C14 18 24 22 38 26 Z"/>${facet(b, 'M50 36 L40 38 L38 64 L44 74 L50 76 Z', 0.28)}<path d="M40 48 L33 50 L39 54 Z" fill="${b}"/>`),
  otter: (b: string) => mirror(`<circle cx="26" cy="32" r="8"/><path d="M50 22 C34 22 20 34 20 54 C20 72 34 84 50 84 Z"/><circle cx="26" cy="32" r="3.5" fill="${b}" opacity=".4"/><circle cx="37" cy="47" r="4" fill="${b}"/>${facet(b, 'M50 56 C40 56 32 60 32 68 C32 76 42 78 50 78 Z', 0.25)}${line(b, 'M38 66 L22 63 M38 70 L24 73', 2.2)}`) + `<path d="M45 57 H55 L50 63 Z" fill="${b}"/>`,
  sealion: (b: string) => `<path d="M30 94 C26 76 30 58 40 46 C44 38 46 30 50 24 C52 20 58 18 62 22 L76 27 L64 31 C62 42 60 56 62 70 C64 80 70 88 80 94 Z"/><path d="M44 64 C34 66 28 72 26 82 C34 80 42 76 48 70 Z"/><circle cx="58" cy="25" r="2.6" fill="${b}"/><circle cx="74" cy="11" r="9"/>${line(b, 'M66 9 Q74 15 82 9', 2.5)}`,
  catfish: (b: string) => `<path d="M10 50 C20 36 40 30 60 36 C70 40 78 44 84 46 L96 34 L94 66 L84 56 C76 60 64 66 48 66 C30 66 18 60 10 50 Z"/><path d="M44 34 L54 22 L60 36 Z"/><path d="M50 64 L58 76 L62 64 Z"/>${line('currentColor', 'M13 52 C8 60 6 66 4 74 M15 55 C15 66 13 72 12 82 M13 47 C8 40 6 34 6 26', 2.6)}<circle cx="23" cy="46" r="2.8" fill="${b}"/>${facet(b, 'M10 50 C30 58 60 58 84 52 L84 56 C76 60 64 66 48 66 C30 66 18 60 10 50 Z')}`,
  gator: (b: string) => `<path d="M2 52 C2 48 6 46 12 46 L58 40 C64 30 80 28 88 38 C96 46 96 54 92 58 L60 57 Z"/><path d="M6 61 L60 61 L91 63 C86 72 74 74 60 72 L8 68 C4 67 4 63 6 61 Z"/><circle cx="74" cy="38" r="3.5" fill="${b}"/>${[14, 24, 34, 44, 54].map((x: number) => `<path d="M${x} 55 L${x + 3} 61 L${x + 6} 55 Z"/>`).join('')}<circle cx="9" cy="49" r="1.6" fill="${b}"/>`,
  wasp: (b: string) => `<g opacity=".55"><ellipse cx="32" cy="36" rx="20" ry="8" transform="rotate(-28 32 36)"/><ellipse cx="68" cy="36" rx="20" ry="8" transform="rotate(28 68 36)"/></g><circle cx="50" cy="16" r="8"/>${line('currentColor', 'M46 10 L38 2 M54 10 L62 2', 2.5)}<ellipse cx="50" cy="35" rx="9" ry="10"/><ellipse cx="50" cy="66" rx="14" ry="22"/>${line(b, 'M34 58 H66 M34 68 H66 M36 78 H64', 5)}<path d="M46 86 L50 98 L54 86 Z"/>`,
  condor: (b: string) => `<path d="M14 94 C14 78 22 68 42 68 C62 68 70 78 70 94 Z"/><path d="M18 72 C18 58 28 50 42 50 C56 50 64 58 64 72 C56 68 50 72 44 68 C36 72 28 68 18 72 Z"/><path d="M40 52 C38 38 44 22 58 20 C68 20 74 26 76 32 L76 42 C68 44 60 48 56 54 Z"/><path d="M74 30 C86 30 93 38 90 48 C86 43 82 41 76 41 Z"/><circle cx="63" cy="30" r="3" fill="${b}"/>${facet(b, 'M18 72 C28 68 36 72 44 68 C50 72 56 68 64 72 L64 76 C50 72 32 72 18 76 Z', 0.3)}`,
  crow: (b: string, a: string) => `<path d="M14 70 C14 44 30 26 52 26 C62 26 70 30 74 36 L96 46 L74 52 C70 64 60 72 50 76 L30 92 L32 76 C20 76 14 74 14 70 Z"/><circle cx="58" cy="40" r="5" fill="${b}"/><circle cx="59" cy="40" r="2" fill="${a}"/>${line(b, 'M26 50 L36 56 M22 60 L34 64 M30 70 L40 70', 2.5)}`,
  flamingo: (b: string) => `<path d="M30 60 C30 50 44 44 60 46 C74 48 86 54 88 60 C80 66 66 70 52 70 C40 70 30 66 30 60 Z"/>${line('currentColor', 'M40 54 C30 44 26 30 36 20 C44 14 54 16 56 24', 7)}<circle cx="53" cy="20" r="7.5"/><path d="M59 20 L68 27 L63 38 L58 27 Z"/><path d="M63 31 L66 30 L63 38 Z" fill="${b}"/><circle cx="54" cy="18" r="1.8" fill="${b}"/>${line('currentColor', 'M58 70 V96 M58 82 L70 76 L66 70', 3)}${facet(b, 'M52 52 C62 50 74 54 80 60 C70 62 60 60 52 52 Z', 0.3)}`,
  squid: (b: string) => mirror(`<path d="M50 4 L34 30 C30 40 34 50 38 54 H50 Z"/><path d="M35 22 L20 34 L36 38 Z"/><circle cx="42" cy="46" r="5" fill="${b}"/>${line('currentColor', 'M40 54 C36 66 44 78 34 92 M46 56 C46 70 40 82 44 96 M34 52 C26 62 30 74 20 84', 6)}`),
  scorpion: (b: string) => `<ellipse cx="50" cy="64" rx="11" ry="15"/><circle cx="50" cy="45" r="7"/><circle cx="50" cy="33" r="6"/><circle cx="55" cy="22" r="5.5"/><circle cx="64" cy="15" r="5"/><path d="M68 10 L80 13 L69 20 Z"/><circle cx="50" cy="80" r="7"/>${line('currentColor', 'M44 82 C34 86 28 90 24 94 M56 82 C66 86 72 90 76 94', 5)}<path d="M24 94 L14 86 L18 98 Z M76 94 L86 86 L82 98 Z"/>${line('currentColor', 'M40 58 L26 52 M39 64 L24 64 M40 70 L26 76 M60 58 L74 52 M61 64 L76 64 M60 70 L74 76', 3)}${line(b, 'M42 60 H58 M41 66 H59', 2)}`,
  crawdad: (b: string) => mirror(`${line('currentColor', 'M43 38 C36 32 30 26 28 20', 6)}<path d="M28 22 C18 22 14 12 18 2 C22 8 26 10 30 10 C34 4 38 4 40 10 C38 18 34 22 28 22 Z"/>${line('currentColor', 'M46 30 C44 18 40 10 34 2', 1.8)}${line('currentColor', 'M40 46 L28 44 M40 52 L28 54 M41 58 L30 62', 3)}`) + `<ellipse cx="50" cy="46" rx="11" ry="15"/><rect x="42" y="61" width="16" height="6" rx="2"/><rect x="43" y="68" width="14" height="6" rx="2"/><rect x="44" y="75" width="12" height="6" rx="2"/><path d="M36 94 L50 82 L64 94 Z"/>${line(b, 'M42 42 H58', 2)}`,
  axes: () => mirror(`${line('currentColor', 'M84 92 L22 22', 7)}<path d="M28 18 L12 6 C4 16 2 30 8 38 L22 28 Z"/>`),
  footprint: () => `<path d="M42 94 C30 94 26 82 28 68 C30 54 26 46 32 36 C38 28 56 28 64 36 C72 44 68 58 66 68 C64 82 58 94 42 94 Z"/><circle cx="31" cy="23" r="7"/><circle cx="43" cy="16" r="6"/><circle cx="54" cy="16" r="5.5"/><circle cx="64" cy="21" r="5"/><circle cx="71" cy="29" r="4.5"/>`,
  boulders: (b: string) => `<path d="M10 86 L16 56 L38 42 L60 50 L66 86 Z"/><path d="M58 86 L64 62 L80 54 L94 68 L92 86 Z"/><path d="M30 46 L40 26 L58 28 L62 48 L38 42 Z"/>${line(b, 'M16 56 L32 64 L38 42 M32 64 L36 86 M64 62 L76 70 L80 54 M76 70 L78 86 M40 26 L46 40', 2.5)}`,
  sunflower: (b: string, a: string) => `${petals(14, 28, 6.5, 14)}<circle cx="50" cy="50" r="18" fill="${b}"/>${[[44, 44], [56, 44], [50, 52], [42, 55], [58, 55], [50, 40], [50, 60]].map(([x, y]: number[]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${a}" opacity=".7"/>`).join('')}`,
  grapes: () => `${[[32, 38], [46, 38], [60, 38], [74, 38], [39, 51], [53, 51], [67, 51], [46, 64], [60, 64], [53, 77]].map(([x, y]: number[]) => `<circle cx="${x - 3}" cy="${y + 2}" r="8"/>`).join('')}${line('currentColor', 'M50 30 L54 12', 4)}<path d="M54 18 C62 6 76 6 84 12 C76 22 64 24 54 18 Z"/>`,
  snowplow: (b: string) => `<rect x="40" y="18" width="20" height="5" rx="2"/><path d="M30 26 H70 L74 54 H26 Z"/><path d="M34 30 H66 L69 48 H31 Z" fill="${b}"/><rect x="22" y="54" width="56" height="14" rx="2"/><rect x="26" y="68" width="12" height="9" rx="2"/><rect x="62" y="68" width="12" height="9" rx="2"/><path d="M4 74 H96 L88 94 H12 Z"/>${line(b, 'M22 76 L16 92 M40 76 L34 92 M58 76 L52 92 M76 76 L70 92', 3)}`,
};

const SYMBOLS: Record<string, SymbolDraw> = { ...GENERIC_SYMBOLS, ...MASCOTS };

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const out = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
/** The pattern colour, a shade of the field so it always reads: darker on light and mid fields,
 * lighter on near-black ones. */
const patternColor = (field: string) => (luminance(field) < 0.16 ? shade(field, 0.16) : shade(field, -0.3));

/** True when this team name has a franchise logo; names from before the pool (old saves, duel
 * links) keep the old code-and-colour mark. */
export function hasTeamLogo(name: string): boolean {
  return franchiseByName(name) !== undefined;
}

/** The inside of one logo's `<svg viewBox="0 0 100 100">`. `clipId` must be unique on the page. */
export function logoMarkup(logo: FranchiseLogo, clipId: string): string {
  const { shape, pattern, symbol, field, accent, rim } = logo;
  const fit = SYMBOL_FIT[shape];
  const draw = SYMBOLS[symbol] ?? GENERIC_SYMBOLS.star;
  return (
    `<defs><clipPath id="${clipId}"><path d="${SHAPES[shape]}" transform="translate(50 50) scale(.86) translate(-50 -50)"/></clipPath></defs>` +
    `<path d="${SHAPES[shape]}" fill="${rim}"/>` +
    `<g clip-path="url(#${clipId})"><rect width="100" height="100" fill="${field}"/>${PATTERNS[pattern](patternColor(field))}</g>` +
    `<g transform="translate(50 ${50 + fit.y}) scale(${fit.s}) translate(-50 -50)" fill="${accent}" color="${accent}">${draw(field, accent)}</g>`
  );
}

/** Every symbol name, so a test can check each franchise's symbol exists. */
export const LOGO_SYMBOLS: readonly string[] = Object.keys(SYMBOLS);

function hueAndSaturation(hex: string): [number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return [0, 0];
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round((h * 60 + 360) % 360), s];
}

/** Hues a team can be shown in, best first: its field, then symbol, then rim — skipping greys and
 * blacks, which have no hue to speak of (Reno's black crest shows as its orange). */
function franchiseHues(logo: FranchiseLogo): number[] {
  const hues = [logo.field, logo.accent, logo.rim].map(hueAndSaturation).filter(([, s]) => s >= 0.25).map(([h]) => h);
  return hues.length ? hues : [hueAndSaturation(logo.field)[0]];
}

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** A team's hue for the screens that tint by team: its franchise colour, or for names outside the
 * pool the old stable hash of the name. */
export function teamHue(name: string): number {
  const franchise = franchiseByName(name);
  return franchise ? franchiseHues(franchise.logo)[0] : hashHue(name);
}

const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Both sides of a game. When the two main colours clash (Boise's green against Tucson's), the
 * second team switches to its next colour, as an away kit would. */
export function matchupHues(a: string, b: string): [number, number] {
  const ha = teamHue(a);
  const franchise = franchiseByName(b);
  const options = franchise ? franchiseHues(franchise.logo) : [hashHue(b)];
  const hb = options.find((h) => hueGap(h, ha) >= 40) ?? (hueGap(options[0], ha) >= 40 ? options[0] : (ha + 180) % 360);
  return [ha, hb];
}
