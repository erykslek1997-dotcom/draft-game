/*
 * Basketball-Reference, pulled from inside the browser (2026-11-18): every season's player TOTALS
 * (games, minutes, FG/FGA, 3P, FT, ORB/DRB/TRB, AST, STL, BLK, TOV, PF, PTS — one row per player and
 * team, plus a TOT row for a traded player), 1946-47 (BAA) to 2025-26. Saves bbref_player_totals.csv.
 * Replaces src/data/raw/playerSeasonStats.csv where that file is incomplete (before the 1980s it misses
 * players and minutes: 1960 holds 22.6k minutes of the league's ~140k; Walt Frazier 1974 shows 21 steals).
 *
 * 1. Open https://www.basketball-reference.com in Chrome or Edge.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. Basketball-Reference allows about 20 pages a minute, so the script waits
 *    3.5 s between pages: 80 seasons ≈ 5 minutes. Progress shows in the console.
 *    If the file did not save, type  bbrefDownload()  and press Enter.
 *
 * FIRST RUN IS A TEST (TEST = true): two seasons only (1961-62 and 1973-74). Paste the console lines
 * to Claude; when they look right, set TEST = false and run again.
 */
(async () => {
  const TEST = true;
  const SEASONS = TEST ? [1962, 1974] : Array.from({ length: 2026 - 1947 + 1 }, (_, i) => 1947 + i);
  const PAUSE_MS = 3500;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;

  async function table(path, id) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(path, { credentials: 'omit' });
        if (res.status === 429) throw new Error('HTTP 429 (too many requests)');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The comment marks are built from pieces: written whole, a browser console reads them as the
        // start of an HTML comment and drops the rest of the line.
        const open = '<' + '!' + '--';
        const close = '--' + '>';
        const html = (await res.text()).split(open).join('').split(close).join('');
        await sleep(PAUSE_MS);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const t = doc.getElementById(id);
        if (!t) return null;
        const rows = [];
        for (const tr of t.querySelectorAll('tbody tr')) {
          if (tr.classList.contains('thead') || tr.classList.contains('over_header')) continue;
          const row = {};
          for (const cell of tr.querySelectorAll('th, td')) {
            const k = cell.getAttribute('data-stat');
            if (!k) continue;
            row[k] = cell.textContent.trim();
            const link = cell.getAttribute('data-append-csv');
            if (link) row[`${k}_id`] = link;
          }
          if (Object.keys(row).length) rows.push(row);
        }
        return rows;
      } catch (e) {
        console.warn(`  attempt ${attempt} failed for ${path} (${e.message}); waiting ${20 * attempt}s`);
        await sleep(20000 * attempt);
      }
    }
    console.error(`  gave up on ${path}`);
    return null;
  }

  const out = [];
  const failed = [];
  for (const y of SEASONS) {
    const season = seasonLabel(y);
    const lg = y <= 1949 ? 'BAA' : 'NBA';
    const rows = (await table(`/leagues/${lg}_${y}_totals.html`, 'totals_stats')) ?? (await table(`/leagues/${lg}_${y}_totals.html`, 'totals'));
    if (rows) for (const r of rows) if (r.name_display || r.player) out.push({ SEASON: season, SEASON_END: y, LG: lg, ...r });
    if (!rows) failed.push(season);
    const minutes = (rows ?? []).filter((r) => r.team_name_abbr !== 'TOT' && r.team_id !== 'TOT').reduce((t, r) => t + (Number(r.mp) || 0), 0);
    console.log(`${season}: ${rows ? rows.length : 0} rows, ${minutes} minutes`);
  }

  const csv = (rows) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  };
  const save = (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  window.bbrefDownload = () => save(TEST ? 'bbref_player_totals_test.csv' : 'bbref_player_totals.csv', csv(out));
  console.log(`rows: ${out.length}, columns: ${Object.keys(out[0] ?? {}).join(', ')}`);
  if (failed.length) console.warn(`FAILED (send this to Claude): ${failed.join(' | ')}`);
  window.bbrefDownload();
  console.log('Done. The CSV is in Downloads — send it to Claude. If it did not save, type  bbrefDownload()  and press Enter.');
})();
