/*
 * 2026-11-11, the user ("a wiemy czy grali w słabych albo mocnych obronach?" → "rób skrypt"): team
 * offensive / defensive ratings before 1973-74, where src/data/raw/bbref/team_advanced.csv stops.
 * BBRef estimates them from points allowed and pace for every season. Input for the team-season
 * defensive regression (`scripts/teamDefenseRapm.ts`), which is validated on 1974-2000 first.
 *
 * 1. Open https://www.basketball-reference.com/ in Chrome or Edge and wait for the page to load.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. TEST = true first: one season (1965), a few seconds. Paste the console output to Claude.
 *    Then set TEST = false and paste again (27 seasons, about 2 minutes). The browser saves
 *    bbref_team_defense.json to Downloads; if it did not, type bbrefTeamDownload() in the console.
 */
(async () => {
  const TEST = true;
  const PAUSE_MS = 3500;
  const FIRST = 1947, LAST = 1974; // 1974 overlaps team_advanced.csv, to check the two agree
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { fetchedAt: new Date().toISOString(), seasons: {}, errors: [] };
  window.bbrefTeamDownload = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
    a.download = 'bbref_team_defense.json';
    a.click();
  };

  function parse(html) {
    const doc = new DOMParser().parseFromString(html.replace(/<!--/g, '').replace(/-->/g, ''), 'text/html');
    // The league page's "Advanced Stats" team table; if its id differs, any table carrying def_rtg.
    let table = doc.getElementById('advanced-team') || [...doc.querySelectorAll('table')].find((t) => t.querySelector('[data-stat="def_rtg"]'));
    const opp = doc.getElementById('per_game-opponent') || doc.getElementById('opponent-stats-per_game');
    const rows = {};
    const read = (t, prefix) => {
      for (const tr of t.querySelectorAll('tbody tr')) {
        const nameCell = tr.querySelector('[data-stat="team"], [data-stat="team_name"]');
        if (!nameCell) continue;
        const team = nameCell.textContent.replace(/\*/g, '').trim();
        if (!team || team === 'League Average') continue;
        const row = (rows[team] = rows[team] || {});
        for (const c of tr.querySelectorAll('td[data-stat]')) row[prefix + c.dataset.stat] = c.textContent.trim();
      }
    };
    if (table) read(table, '');
    if (opp) read(opp, 'opp_');
    return { rows, tableId: table ? table.id : null, oppId: opp ? opp.id : null, ids: [...doc.querySelectorAll('table[id]')].map((t) => t.id) };
  }

  const years = TEST ? [1965] : Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
  for (const y of years) {
    const url = `https://www.basketball-reference.com/leagues/${y < 1950 ? 'BAA' : 'NBA'}_${y}.html`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = parse(await res.text());
      const teams = Object.keys(p.rows);
      out.seasons[y] = p.rows;
      const first = p.rows[teams[0]] || {};
      console.log(`${y}: ${teams.length} teams, table "${p.tableId}", opponent "${p.oppId}"; ${teams[0]} def_rtg ${first.def_rtg} off_rtg ${first.off_rtg} pace ${first.pace} opp_pts ${first.opp_pts}`);
      if (!p.tableId) console.warn(`  no rating table; ids on page: ${p.ids.join(', ')}`);
    } catch (e) {
      out.errors.push(`${y}: ${e.message}`);
      console.error(`${y}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  console.log(`done: ${Object.keys(out.seasons).length} seasons, ${out.errors.length} errors`);
  if (!TEST) window.bbrefTeamDownload();
})();
