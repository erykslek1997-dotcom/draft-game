/*
 * The same data as fetch_nba_stats.py, pulled from inside the browser (2026-10-07: stats.nba.com
 * holds Python's requests until they time out, but answers its own website).
 *
 * 1. Open https://www.nba.com/stats in Chrome or Edge and wait for the page to load.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. Progress shows in the console; at the end the browser saves one file,
 *    nba_stats.json, to Downloads. Send it to Claude. If it didn't save, type nbaStatsDownload() in
 *    the console and press Enter — the data stays on the page until you close the tab.
 *
 * To fetch only some seasons, change SEASONS below before pasting.
 */
(async () => {
  const SEASONS = [];
  for (let y = 2015; y <= 2024; y++) SEASONS.push(`${y}-${String(y + 1).slice(2)}`);
  const PAUSE_MS = 800;
  const PLAY_TYPES = ['Isolation', 'Transition', 'PRBallHandler', 'PRRollman', 'Postup', 'Spotup', 'Handoff', 'Cut', 'OffScreen', 'OffRebound', 'Misc'];
  const DASH = {
    College: '', Conference: '', Country: '', DateFrom: '', DateTo: '', Division: '', DraftPick: '', DraftYear: '',
    GameScope: '', GameSegment: '', Height: '', LastNGames: '0', LeagueID: '00', Location: '', Month: '0',
    OpponentTeamID: '0', Outcome: '', PORound: '0', Period: '0', PlayerExperience: '', PlayerPosition: '',
    SeasonSegment: '', SeasonType: 'Regular Season', ShotClockRange: '', StarterBench: '', TeamID: '0', TwoWay: '0',
    VsConference: '', VsDivision: '', Weight: '',
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(endpoint, params) {
    const url = `https://stats.nba.com/stats/${endpoint}?${new URLSearchParams(params)}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' }, credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const set = (data.resultSets && data.resultSets[0]) || data.resultSet;
        await sleep(PAUSE_MS);
        return set ? { headers: set.headers, rows: set.rowSet } : { headers: [], rows: [] };
      } catch (e) {
        console.warn(`  attempt ${attempt} failed for ${endpoint} (${e.message}); waiting ${3 * attempt}s`);
        await sleep(3000 * attempt);
      }
    }
    console.error(`  gave up on ${url}`);
    return { headers: [], rows: [] };
  }
  const tables = {};
  function add(name, { headers, rows }, extra) {
    const t = (tables[name] ??= { columns: [], rows: [] });
    for (const h of [...Object.keys(extra), ...headers]) if (!t.columns.includes(h)) t.columns.push(h);
    for (const r of rows) {
      const d = { ...extra };
      headers.forEach((h, i) => (d[h] = r[i]));
      t.rows.push(d);
    }
  }

  console.log('Checking that stats.nba.com answers...');
  const probe = await get('leaguedashteamstats', { ...DASH, MeasureType: 'Base', PerMode: 'PerGame', Season: SEASONS[SEASONS.length - 1], PaceAdjust: 'N', PlusMinus: 'N', Rank: 'N' });
  if (!probe.rows.length) {
    console.error('stats.nba.com did not answer. Make sure this tab is on www.nba.com/stats and try again.');
    return;
  }
  console.log(`  OK (${probe.rows.length} teams)`);

  for (const season of SEASONS) {
    console.log(season);
    for (const play of PLAY_TYPES) {
      for (const [who, grouping, name] of [['T', 'offensive', 'playtypes_team_offense'], ['T', 'defensive', 'playtypes_team_defense'], ['P', 'offensive', 'playtypes_player_offense']]) {
        add(name, await get('synergyplaytypes', { LeagueID: '00', PerMode: 'Totals', PlayType: play, PlayerOrTeam: who, SeasonType: 'Regular Season', SeasonYear: season, TypeGrouping: grouping }), { SEASON: season, PLAY_TYPE: play });
      }
    }
    console.log('  play types done');
    for (const [measure, name] of [['Advanced', 'team_advanced'], ['Misc', 'team_misc']]) {
      add(name, await get('leaguedashteamstats', { ...DASH, MeasureType: measure, PerMode: 'PerGame', Season: season, PaceAdjust: 'N', PlusMinus: 'N', Rank: 'N' }), { SEASON: season });
    }
    for (const [measure, name] of [['CatchShoot', 'player_catch_shoot'], ['PullUpShot', 'player_pull_up'], ['Drives', 'player_drives'], ['Passing', 'player_passing']]) {
      add(name, await get('leaguedashptstats', { ...DASH, PtMeasureType: measure, PlayerOrTeam: 'Player', PerMode: 'Totals', Season: season }), { SEASON: season });
    }
    for (const [category, name] of [['Overall', 'defense_overall'], ['3 Pointers', 'defense_3pt'], ['Less Than 6Ft', 'defense_rim']]) {
      add(name, await get('leaguedashptdefend', { ...DASH, DefenseCategory: category, PerMode: 'Totals', Season: season }), { SEASON: season });
    }
    console.log('  tracking done');
  }
  // One file, not twelve: browsers block a page that starts many downloads at once (2026-10-07,
  // only the first CSV arrived). Kept on the page too, so window.nbaStatsDownload() saves it again.
  const bundle = JSON.stringify(tables);
  window.nbaStatsDownload = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bundle], { type: 'application/json' }));
    a.download = 'nba_stats.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  for (const [name, t] of Object.entries(tables)) console.log(`${name}: ${t.rows.length} rows`);
  window.nbaStatsDownload();
  console.log('Done: nba_stats.json is in your Downloads folder. Send it to Claude. If it did not save, type  nbaStatsDownload()  here and press Enter.');
})();
