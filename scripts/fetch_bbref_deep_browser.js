/*
 * 2026-11-06, the user ("najpierw obszerny scrapping"): the basketball-reference league tables the
 * engine does not have yet, pulled from inside the browser (this environment cannot reach bbref).
 *
 *  - play-by-play  (1996-97 on): position estimates, on-court +/- and on-off, bad passes, lost
 *                   balls, shooting/offensive fouls drawn and committed, and-ones, blocked shots
 *  - shooting      (1996-97 on): FGA and FG% by distance, the share of makes ASSISTED by distance
 *                   (2pt / 3pt), dunks, corner threes, heaves — the self-creation and catch-and-
 *                   shoot read for the years before NBA.com's tracking (2013-14)
 *  - per_poss      (1973-74 on): per-100-possession box score and ORtg/DRtg, every era on one pace
 *  - advanced      (every season): to have the whole 1950-2026 table in one place
 *
 * 1. Open https://www.basketball-reference.com/ in Chrome or Edge and wait for the page to load.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. TEST = true first: one season (2004), a few seconds. Paste the first lines of the console
 *    output to Claude. Then set TEST = false and paste again for the full pull (about 12 minutes, 192 pages:
 *    bbref allows ~20 pages a minute, so the script waits 3.5 s between pages). At the end the
 *    browser saves bbref_deep.json to Downloads; if it did not, type bbrefDeepDownload() in the
 *    console. Send the file to Claude.
 */
(async () => {
  const TEST = true;
  const PAUSE_MS = 3500;
  const LAST = 2026;
  const TABLES = [
    { key: 'pbp', page: 'play-by-play', id: 'pbp_stats', from: 1997 },
    { key: 'shooting', page: 'shooting', id: 'shooting_stats', from: 1997 },
    { key: 'per_poss', page: 'per_poss', id: 'per_poss_stats', from: 1974 },
    { key: 'advanced', page: 'advanced', id: 'advanced_stats', from: 1950 },
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { fetchedAt: new Date().toISOString(), tables: {}, errors: [] };
  window.bbrefDeepDownload = () => {
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bbref_deep.json';
    a.click();
  };

  /** Rows of one table as objects keyed by bbref's data-stat names (stable across header changes).
   * Tables bbref ships inside an HTML comment are found too. */
  function parseTable(html, id) {
    // bbref serves most league tables inside HTML comments; strip the comment markers so every
    // table parses the same way.
    const doc = new DOMParser().parseFromString(html.replace(/<!--/g, '').replace(/-->/g, ''), 'text/html');
    // Find the table by id; if the id guess is wrong, fall back to the page's biggest per-player
    // table (one whose cells carry data-stat and whose rows name players) and report its real id.
    let table = doc.getElementById(id);
    if (!table) {
      const cand = [...doc.querySelectorAll('table')]
        .filter((t) => t.querySelector('td[data-stat], th[data-stat]') && t.querySelector('a[href*="/players/"]'))
        .sort((a, b) => b.querySelectorAll('tbody tr').length - a.querySelectorAll('tbody tr').length);
      table = cand[0] || null;
      if (table) console.warn(`  (id "${id}" not found — used biggest table "${table.id || '(no id)'}"; ids on page: ${[...doc.querySelectorAll('table[id]')].map((t) => t.id).join(', ') || 'none'})`);
    }
    if (!table) return null;
    const rows = [];
    for (const tr of table.querySelectorAll('tbody tr')) {
      if (tr.classList.contains('thead') || tr.classList.contains('over_header')) continue;
      const row = {};
      for (const cell of tr.querySelectorAll('th, td')) {
        const stat = cell.getAttribute('data-stat');
        if (!stat) continue;
        row[stat] = cell.textContent.trim();
        const link = cell.querySelector('a[href*="/players/"]');
        if (link) row.player_id = link.getAttribute('href').split('/').pop().replace('.html', '');
        if (cell.getAttribute('data-append-csv')) row.player_id = cell.getAttribute('data-append-csv');
      }
      if (row.player || row.name_display) rows.push(row);
    }
    return rows;
  }

  async function get(url) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(url);
      if (res.ok) return res.text();
      if (res.status === 429) {
        console.warn(`429 (too many requests) — waiting 70 s, attempt ${attempt}`);
        await sleep(70000);
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    throw new Error('429 four times');
  }

  const jobs = [];
  for (const t of TABLES) {
    const years = [];
    for (let y = t.from; y <= LAST; y++) years.push(y);
    for (const y of TEST ? [2004] : years) jobs.push({ t, y });
  }
  console.log(`bbref deep: ${jobs.length} pages${TEST ? ' (TEST: season 2003-04 only)' : ''}`);
  let n = 0;
  for (const { t, y } of jobs) {
    n++;
    const url = `https://www.basketball-reference.com/leagues/NBA_${y}_${t.page}.html`;
    try {
      const rows = parseTable(await get(url), t.id);
      if (!rows) throw new Error(`no table #${t.id}`);
      (out.tables[t.key] ??= {})[y] = rows;
      console.log(`${n}/${jobs.length} ${t.key} ${y}: ${rows.length} rows${TEST ? ` · first: ${JSON.stringify(rows[0]).slice(0, 400)}` : ''}`);
    } catch (e) {
      out.errors.push({ url, error: String(e) });
      console.error(`${n}/${jobs.length} ${t.key} ${y}: ${e}`);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`done: ${out.errors.length} errors`);
  window.bbrefDeepDownload();
})();
