/*
 * Basketball-Reference, pulled from inside the browser (2026-10-28): every season's team Advanced
 * Stats (W/L, MOV, SRS, ORtg, DRtg, Pace, four factors) and player Advanced (USG%, AST%, STL%, BLK%,
 * TRB%, TS%, BPM, VORP). Saves two CSV files: bbref_team_advanced.csv and bbref_player_advanced.csv.
 *
 * 1. Open https://www.basketball-reference.com in Chrome or Edge.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. Basketball-Reference allows about 20 pages a minute, so the script waits
 *    3.5 s between pages: 53 seasons × 2 pages ≈ 7 minutes. Progress shows in the console.
 *    If the files did not save, type  bbrefDownload()  and press Enter.
 *
 * FIRST RUN IS A TEST (TEST = true): two seasons only. Paste the console lines to Claude; when they
 * look right, set TEST = false and run again.
 */
(async () => {
  const TEST = true;
  const FIRST = TEST ? 2023 : 1974; // season end year: 1974 = 1973-74
  const LAST = TEST ? 2024 : 2026;
  const PAUSE_MS = 3500;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;

  /** A table by id; Basketball-Reference ships many tables inside HTML comments. */
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

  const out = { team: [], player: [] };
  const failed = [];
  for (let y = FIRST; y <= LAST; y++) {
    const season = seasonLabel(y);
    const team = (await table(`/leagues/NBA_${y}.html`, 'advanced-team')) ?? (await table(`/leagues/NBA_${y}.html`, 'misc_stats'));
    if (team) for (const r of team) out.team.push({ SEASON: season, ...r });
    else failed.push(`team ${season}`);
    const player = await table(`/leagues/NBA_${y}_advanced.html`, 'advanced');
    if (player) for (const r of player) out.player.push({ SEASON: season, ...r });
    else failed.push(`player ${season}`);
    console.log(`${season}: ${team ? team.length : 0} teams, ${player ? player.length : 0} player rows`);
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
  window.bbrefDownload = async () => {
    save(TEST ? 'bbref_team_advanced_test.csv' : 'bbref_team_advanced.csv', csv(out.team));
    await sleep(1500); // two downloads a moment apart, or the browser keeps only the first
    save(TEST ? 'bbref_player_advanced_test.csv' : 'bbref_player_advanced.csv', csv(out.player));
  };
  console.log(`team rows: ${out.team.length}, columns: ${Object.keys(out.team[0] ?? {}).slice(0, 12).join(', ')}…`);
  console.log(`player rows: ${out.player.length}, columns: ${Object.keys(out.player[0] ?? {}).slice(0, 12).join(', ')}…`);
  if (failed.length) console.warn(`FAILED (send this to Claude): ${failed.join(' | ')}`);
  await window.bbrefDownload();
  console.log('Done. Two CSV files are in Downloads — send them to Claude. If they did not save, type  bbrefDownload()  and press Enter.');
})();
