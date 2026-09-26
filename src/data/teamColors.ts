/**
 * Team colours for our own team badges (group C mockup "Team badges"): a franchise code plus a
 * season in that era's colours — no league or team logos. Codes are the ones used in
 * `cardCareerMetadata.json`. `eras` lists colour changes by the first season-end year they apply
 * from; the base pair applies before the first era.
 */
interface TeamColorEntry {
  primary: string;
  secondary: string;
  eras?: { from: number; primary: string; secondary: string }[];
}

const TEAM_COLORS: Record<string, TeamColorEntry> = {
  ATL: { primary: '#C8102E', secondary: '#FDB927' },
  BAL: { primary: '#0046AD', secondary: '#C8102E' },
  BKN: { primary: '#000000', secondary: '#FFFFFF' },
  BLB: { primary: '#0046AD', secondary: '#C8102E' },
  BOS: { primary: '#007A33', secondary: '#FFFFFF' },
  BUF: { primary: '#1E4CA1', secondary: '#F58426' },
  CAP: { primary: '#0046AD', secondary: '#C8102E' },
  CHA: { primary: '#1D1160', secondary: '#00788C' },
  CHH: { primary: '#00778B', secondary: '#5B2B82' },
  CHI: { primary: '#CE1141', secondary: '#000000' },
  CHP: { primary: '#F58426', secondary: '#000000' },
  CHS: { primary: '#C8102E', secondary: '#002F6C' },
  CHZ: { primary: '#0046AD', secondary: '#FFFFFF' },
  CIN: { primary: '#002F6C', secondary: '#C8102E' },
  CLE: { primary: '#860038', secondary: '#FDBB30', eras: [{ from: 1995, primary: '#E35205', secondary: '#002F6C' }, { from: 2004, primary: '#860038', secondary: '#FDBB30' }] },
  DAL: { primary: '#0053BC', secondary: '#00A94F', eras: [{ from: 2002, primary: '#00538C', secondary: '#B8C4CA' }] },
  DEN: { primary: '#0E2240', secondary: '#FEC524' },
  DET: { primary: '#1D42BA', secondary: '#C8102E', eras: [{ from: 1997, primary: '#006272', secondary: '#8A1538' }, { from: 2002, primary: '#1D42BA', secondary: '#C8102E' }] },
  FTW: { primary: '#1D42BA', secondary: '#C8102E' },
  GSW: { primary: '#1D428A', secondary: '#FFC72C' },
  HOU: { primary: '#CE1141', secondary: '#FDB927', eras: [{ from: 1996, primary: '#CE1141', secondary: '#C4CED4' }] },
  IND: { primary: '#002D62', secondary: '#FDBB30' },
  KCK: { primary: '#002F6C', secondary: '#C8102E' },
  KCO: { primary: '#002F6C', secondary: '#C8102E' },
  LAC: { primary: '#C8102E', secondary: '#1D428A' },
  LAL: { primary: '#552583', secondary: '#FDB927' },
  MEM: { primary: '#12173F', secondary: '#5D76A9' },
  MIA: { primary: '#98002E', secondary: '#F9A01B' },
  MIL: { primary: '#00471B', secondary: '#EEE1C6' },
  MIN: { primary: '#0C2340', secondary: '#78BE20' },
  MLH: { primary: '#C8102E', secondary: '#002F6C' },
  MNL: { primary: '#1D428A', secondary: '#FDB927' },
  NJN: { primary: '#002A60', secondary: '#CD1041' },
  NOH: { primary: '#0C2340', secondary: '#00778B' },
  NOJ: { primary: '#5B2B82', secondary: '#FDB927' },
  NOK: { primary: '#0C2340', secondary: '#00778B' },
  NOP: { primary: '#0C2340', secondary: '#C8102E' },
  NYK: { primary: '#006BB6', secondary: '#F58426' },
  NYN: { primary: '#002A60', secondary: '#CD1041' },
  OKC: { primary: '#007AC1', secondary: '#EF3B24' },
  ORL: { primary: '#0077C0', secondary: '#C4CED4' },
  PHI: { primary: '#006BB6', secondary: '#ED174C' },
  PHW: { primary: '#1D428A', secondary: '#FFC72C' },
  PHX: { primary: '#1D1160', secondary: '#E56020' },
  POR: { primary: '#E03A3E', secondary: '#000000' },
  ROC: { primary: '#002F6C', secondary: '#C8102E' },
  SAC: { primary: '#C8102E', secondary: '#002F6C', eras: [{ from: 1995, primary: '#5A2D81', secondary: '#63727A' }] },
  SAS: { primary: '#000000', secondary: '#C4CED4' },
  SDC: { primary: '#0B3D91', secondary: '#F58426' },
  SDR: { primary: '#006341', secondary: '#FDB927' },
  SEA: { primary: '#00653A', secondary: '#FFC200' },
  SFW: { primary: '#1D428A', secondary: '#FFC72C' },
  STB: { primary: '#002F6C', secondary: '#C8102E' },
  STL: { primary: '#C8102E', secondary: '#002F6C' },
  SYR: { primary: '#1D428A', secondary: '#C8102E' },
  TOR: { primary: '#753BBD', secondary: '#CE1141', eras: [{ from: 2007, primary: '#CE1141', secondary: '#000000' }] },
  UTA: { primary: '#5B2B82', secondary: '#00471B', eras: [{ from: 1997, primary: '#002B5C', secondary: '#F9A01B' }] },
  VAN: { primary: '#00B2A9', secondary: '#E43C40' },
  WAS: { primary: '#002B5C', secondary: '#E31837' },
};

const FALLBACK: TeamColorEntry = { primary: '#2F74B8', secondary: '#14395F' };

/** Readable text colour on a background: dark ink on light colours, white otherwise. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#FFFFFF';
}

export interface TeamColors {
  primary: string;
  secondary: string;
  primaryInk: string;
  secondaryInk: string;
}

export function teamColors(code: string, seasonEnd?: number): TeamColors {
  const entry = TEAM_COLORS[code] ?? FALLBACK;
  const era = seasonEnd === undefined ? undefined : [...(entry.eras ?? [])].reverse().find((e) => seasonEnd >= e.from);
  const primary = era?.primary ?? entry.primary;
  const secondary = era?.secondary ?? entry.secondary;
  return { primary, secondary, primaryInk: inkOn(primary), secondaryInk: inkOn(secondary) };
}

/** "'04" for 2004. */
export function seasonTag(seasonEnd: number): string {
  return `'${String(seasonEnd % 100).padStart(2, '0')}`;
}
