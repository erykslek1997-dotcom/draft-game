/*
 * The second NBA.com pull (2026-10-28, TODO "Skrypt NBA.com"): what fetch_nba_stats_browser.js does
 * not have — five-man lineups, player on/off, hustle, tracking rebounds / possessions / speed,
 * defense by zone, clutch. Same method: it runs in the browser console on nba.com/stats and saves
 * one file, nba_stats_extra.json.
 *
 * 1. Open https://www.nba.com/stats in Chrome or Edge and wait for the page to load.
 * 2. Press F12, open the "Console" tab. If it asks, type   allow pasting   and press Enter.
 * 3. Paste this whole file and press Enter.
 * 4. Leave the tab open. At the end the browser saves nba_stats_extra.json to Downloads. If it did
 *    not, type nbaStatsExtraDownload() in the console. Send the file to Claude.
 *
 * FIRST RUN IS A TEST: it fetches one season (TEST = true below) so a wrong parameter shows up in a
 * minute, not after an hour. Paste the console output (or the error) to Claude. When it looks right,
 * set TEST = false and run again: it then pulls every season each table exists for.
 */
(async () => {
  const TEST = true;
  const TEST_SEASON = '2023-24';
  const PAUSE_MS = 800;
  const season = (y) => `${y}-${String(y + 1).slice(2)}`;
  // First season each table exists for (NBA.com: lineups and on/off from 2007-08, hustle from
  // 2015-16, tracking from 2013-14, play-by-play clutch from 1996-97).
  const FROM = { lineups: 2007, onoff: 2007, clutch: 2007, hustle: 2015, tracking: 2013, zones: 2013 };
  const LAST = 2025;
  const seasonsFor = (key) => {
    if (TEST) return [TEST_SEASON];
    const out = [];
    for (let y = FROM[key]; y <= LAST; y++) out.push(season(y));
    return out;
  };
  const DASH = {
    College: '', Conference: '', Country: '', DateFrom: '', DateTo: '', Division: '', DraftPick: '', DraftYear: '',
    GameScope: '', GameSegment: '', Height: '', LastNGames: '0', LeagueID: '00', Location: '', Month: '0',
    OpponentTeamID: '0', Outcome: '', PORound: '0', Period: '0', PlayerExperience: '', PlayerPosition: '',
    SeasonSegment: '', SeasonType: 'Regular Season', ShotClockRange: '', StarterBench: '', TeamID: '0', TwoWay: '0',
    VsConference: '', VsDivision: '', Weight: '', PaceAdjust: 'N', PlusMinus: 'N', Rank: 'N',
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tables = {};
  const failed = [];

  /** Every result set of an endpoint: [{ name, headers, rows }]. */
  async function getSets(endpoint, params) {
    const url = `https://stats.nba.com/stats/${endpoint}?${new URLSearchParams(params)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' }, credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        await sleep(PAUSE_MS);
        const sets = data.resultSets || (data.resultSet ? [data.resultSet] : []);
        return sets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rowSet }));
      } catch (e) {
        console.warn(`  attempt ${attempt} failed for ${endpoint} (${e.message}); waiting ${3 * attempt}s`);
        await sleep(3000 * attempt);
      }
    }
    console.error(`  gave up on ${endpoint} ${JSON.stringify(params)}`);
    failed.push(`${endpoint} ${params.Season ?? ''}`);
    return [];
  }
  function add(name, set, extra) {
    if (!set) return;
    const t = (tables[name] ??= { columns: [], rows: [] });
    for (const h of [...Object.keys(extra), ...set.headers]) if (!t.columns.includes(h)) t.columns.push(h);
    for (const r of set.rows) {
      const d = { ...extra };
      set.headers.forEach((h, i) => (d[h] = r[i]));
      t.rows.push(d);
    }
  }
  const first = async (endpoint, params) => (await getSets(endpoint, params))[0];

  console.log(`Checking that stats.nba.com answers... (${TEST ? `TEST, ${TEST_SEASON} only` : 'full run'})`);
  const probe = await first('leaguedashteamstats', { ...DASH, MeasureType: 'Base', PerMode: 'PerGame', Season: TEST ? TEST_SEASON : season(LAST) });
  if (!probe || !probe.rows.length) {
    console.error('stats.nba.com did not answer. Make sure this tab is on www.nba.com/stats and try again.');
    return;
  }
  const idCol = probe.headers.indexOf('TEAM_ID');
  const teamIds = probe.rows.map((r) => r[idCol]);
  console.log(`  OK (${teamIds.length} teams)`);

  // 1. Five-man lineups: minutes, net rating, the units themselves (validates Fit / cohesion).
  for (const s of seasonsFor('lineups')) {
    for (const measure of ['Base', 'Advanced']) {
      add(`lineups_${measure.toLowerCase()}`, await first('leaguedashlineups', { ...DASH, GroupQuantity: '5', MeasureType: measure, PerMode: 'Totals', Season: s }), { SEASON: s });
    }
    console.log(`${s} lineups done`);
  }

  // 2. Player on/off per team: net rating with and without the player.
  for (const s of seasonsFor('onoff')) {
    for (const id of teamIds) {
      const sets = await getSets('teamplayeronoffsummary', { DateFrom: '', DateTo: '', GameSegment: '', LastNGames: '0', LeagueID: '00', Location: '', MeasureType: 'Advanced', Month: '0', OpponentTeamID: '0', Outcome: '', PORound: '0', PaceAdjust: 'N', PerMode: 'Totals', Period: '0', PlusMinus: 'N', Rank: 'N', Season: s, SeasonSegment: '', SeasonType: 'Regular Season', ShotClockRange: '', TeamID: String(id), VsConference: '', VsDivision: '' });
      for (const set of sets) {
        const label = /OffCourt/i.test(set.name) ? 'off' : /OnCourt/i.test(set.name) ? 'on' : null;
        if (label) add(`onoff_${label}`, set, { SEASON: s });
      }
    }
    console.log(`${s} on/off done`);
  }

  // 3. Hustle: deflections, contested shots, screen assists, loose balls, charges.
  for (const s of seasonsFor('hustle')) {
    add('hustle_player', await first('leaguehustlestatsplayer', { ...DASH, PerMode: 'Totals', Season: s }), { SEASON: s });
    console.log(`${s} hustle done`);
  }

  // 4. Tracking: rebounds (contested / chances), possessions and touches, speed and distance.
  for (const s of seasonsFor('tracking')) {
    for (const [measure, name] of [['Rebounding', 'player_rebounding'], ['Possessions', 'player_possessions'], ['SpeedDistance', 'player_speed'], ['Efficiency', 'player_efficiency']]) {
      add(name, await first('leaguedashptstats', { ...DASH, PtMeasureType: measure, PlayerOrTeam: 'Player', PerMode: 'Totals', Season: s }), { SEASON: s });
    }
    console.log(`${s} tracking done`);
  }

  // 5. Defense by zone (the Overall / 3 Pointers / Less Than 6Ft tables are in the first file).
  for (const s of seasonsFor('zones')) {
    for (const [category, name] of [['2 Pointers', 'defense_2pt'], ['Less Than 10Ft', 'defense_lt10'], ['Greater Than 15Ft', 'defense_gt15']]) {
      add(name, await first('leaguedashptdefend', { ...DASH, DefenseCategory: category, PerMode: 'Totals', Season: s }), { SEASON: s });
    }
    console.log(`${s} defense zones done`);
  }

  // 6. Clutch: last 5 minutes, margin of 5 or less.
  for (const s of seasonsFor('clutch')) {
    add('clutch_player', await first('leaguedashplayerclutch', { ...DASH, MeasureType: 'Advanced', PerMode: 'Totals', Season: s, ClutchTime: 'Last 5 Minutes', AheadBehind: 'Ahead or Behind', PointDiff: '5' }), { SEASON: s });
    console.log(`${s} clutch done`);
  }

  const bundle = JSON.stringify(tables);
  window.nbaStatsExtraDownload = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bundle], { type: 'application/json' }));
    a.download = TEST ? 'nba_stats_extra_test.json' : 'nba_stats_extra.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  for (const [name, t] of Object.entries(tables)) console.log(`${name}: ${t.rows.length} rows, columns: ${t.columns.slice(0, 8).join(', ')}…`);
  const empty = ['lineups_base', 'lineups_advanced', 'onoff_on', 'onoff_off', 'hustle_player', 'player_rebounding', 'player_possessions', 'player_speed', 'player_efficiency', 'defense_2pt', 'defense_lt10', 'defense_gt15', 'clutch_player'].filter((n) => !tables[n] || !tables[n].rows.length);
  if (empty.length) console.warn(`EMPTY tables (send this line to Claude): ${empty.join(', ')}`);
  if (failed.length) console.warn(`FAILED calls (send this to Claude): ${failed.join(' | ')}`);
  window.nbaStatsExtraDownload();
  console.log(`Done. ${TEST ? 'This was the TEST run — paste the lines above to Claude.' : 'nba_stats_extra.json is in Downloads — send it to Claude.'} If nothing saved, type  nbaStatsExtraDownload()  and press Enter.`);
})();
