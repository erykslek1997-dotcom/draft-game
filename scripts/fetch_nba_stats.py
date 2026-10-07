#!/usr/bin/env python3
"""
Pulls NBA.com tracking and play-type data for the live game's next calibration (2026-10-07, the
user: "pisz"). Run it on your own computer — stats.nba.com refuses most requests that don't look
like a browser, and some networks block it entirely.

    python3 scripts/fetch_nba_stats.py                 # every season 2015-16 .. 2024-25
    python3 scripts/fetch_nba_stats.py --seasons 2022-23 2023-24
    python3 scripts/fetch_nba_stats.py --out ~/Desktop/nba_stats

No extra packages needed (Python 3.8+ standard library). Each request is cached under
<out>/raw/, so if NBA.com cuts you off halfway, run the same command again and it picks up where
it stopped. When it finishes, send me the CSV files from <out>/ (not the raw/ folder).

What it downloads, one CSV per dataset, every season stacked with a SEASON column:
  playtypes_team_offense.csv / playtypes_team_defense.csv   Synergy play types per team
  playtypes_player_offense.csv                              Synergy play types per player
      (isolation, transition, P&R ball handler / roll man, post-up, spot-up, hand-off, cut,
       off screen, putbacks, misc: possessions, frequency, points per possession, TOV%, FT%)
  team_advanced.csv      pace, offensive / defensive rating, AST%, TOV%, rebound %
  team_misc.csv          fast-break points, points off turnovers, second-chance points, paint
  player_catch_shoot.csv catch-and-shoot attempts and accuracy per player
  player_pull_up.csv     pull-up attempts and accuracy per player
  player_drives.csv      drives, and what they produce (points, passes, fouls, turnovers)
  player_passing.csv     passes, potential assists, assist points created
  defense_overall.csv / defense_3pt.csv / defense_rim.csv
                         opponents' shooting against each defender, against their normal level
"""
import argparse
import csv
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://stats.nba.com/stats/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip",
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Connection": "keep-alive",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}
PAUSE_SECONDS = 1.5
RETRIES = 4
TIMEOUT_SECONDS = 60

PLAY_TYPES = [
    "Isolation", "Transition", "PRBallHandler", "PRRollman", "Postup", "Spotup",
    "Handoff", "Cut", "OffScreen", "OffRebound", "Misc",
]

# The blank filters stats.nba.com expects on its league dashboards.
DASH_FILTERS = {
    "College": "", "Conference": "", "Country": "", "DateFrom": "", "DateTo": "", "Division": "",
    "DraftPick": "", "DraftYear": "", "GameScope": "", "GameSegment": "", "Height": "",
    "LastNGames": "0", "LeagueID": "00", "Location": "", "Month": "0", "OpponentTeamID": "0",
    "Outcome": "", "PORound": "0", "Period": "0", "PlayerExperience": "", "PlayerPosition": "",
    "SeasonSegment": "", "SeasonType": "Regular Season", "ShotClockRange": "", "StarterBench": "",
    "TeamID": "0", "TwoWay": "0", "VsConference": "", "VsDivision": "", "Weight": "",
}


def fetch(endpoint, params, raw_dir):
    """One request, cached on disk; returns (headers, rows) of the first result set."""
    key = endpoint + "_" + "_".join(f"{k}-{v}" for k, v in sorted(params.items()) if v not in ("", "0"))
    key = "".join(c if c.isalnum() or c in "-_." else "_" for c in key)[:180]
    cache = os.path.join(raw_dir, key + ".json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            data = json.load(f)
    else:
        url = BASE + endpoint + "?" + urllib.parse.urlencode(params)
        data = None
        for attempt in range(1, RETRIES + 1):
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                    body = resp.read()
                    if resp.headers.get("Content-Encoding") == "gzip":
                        body = gzip.decompress(body)
                    data = json.loads(body.decode("utf-8"))
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
                wait = PAUSE_SECONDS * 4 * attempt
                print(f"    attempt {attempt} failed ({e}); waiting {wait:.0f}s", file=sys.stderr)
                time.sleep(wait)
        if data is None:
            print(f"    giving up on {url}", file=sys.stderr)
            return [], []
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(data, f)
        time.sleep(PAUSE_SECONDS)
    sets = data.get("resultSets") or [data.get("resultSet")]
    first = sets[0] if isinstance(sets, list) else sets
    if not first:
        return [], []
    return first.get("headers", []), first.get("rowSet", [])


class Table:
    """Rows from many requests, written once with one header (columns can differ by season)."""

    def __init__(self, path):
        self.path = path
        self.columns = []
        self.rows = []

    def add(self, headers, rows, **extra):
        for h in list(extra) + list(headers):
            if h not in self.columns:
                self.columns.append(h)
        for r in rows:
            d = dict(zip(headers, r))
            d.update(extra)
            self.rows.append(d)

    def write(self):
        if not self.rows:
            print(f"  (nothing for {os.path.basename(self.path)})")
            return
        with open(self.path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=self.columns, extrasaction="ignore")
            w.writeheader()
            w.writerows(self.rows)
        print(f"  wrote {os.path.basename(self.path)}: {len(self.rows)} rows")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--seasons", nargs="*", default=[f"{y}-{str(y + 1)[2:]}" for y in range(2015, 2025)])
    ap.add_argument("--out", default="nba_stats")
    args = ap.parse_args()
    out = os.path.expanduser(args.out)
    raw = os.path.join(out, "raw")
    os.makedirs(raw, exist_ok=True)

    tables = {name: Table(os.path.join(out, name + ".csv")) for name in [
        "playtypes_team_offense", "playtypes_team_defense", "playtypes_player_offense",
        "team_advanced", "team_misc",
        "player_catch_shoot", "player_pull_up", "player_drives", "player_passing",
        "defense_overall", "defense_3pt", "defense_rim",
    ]}

    for season in args.seasons:
        print(f"{season}")
        # Synergy play types (2015-16 on).
        for play in PLAY_TYPES:
            for who, grouping, table in [("T", "offensive", "playtypes_team_offense"), ("T", "defensive", "playtypes_team_defense"), ("P", "offensive", "playtypes_player_offense")]:
                h, rows = fetch("synergyplaytypes", {
                    "LeagueID": "00", "PerMode": "Totals", "PlayType": play, "PlayerOrTeam": who,
                    "SeasonType": "Regular Season", "SeasonYear": season, "TypeGrouping": grouping,
                }, raw)
                tables[table].add(h, rows, SEASON=season, PLAY_TYPE=play)
        print("  play types done")
        # Team pace, ratings; fast breaks and second chances.
        for measure, table in [("Advanced", "team_advanced"), ("Misc", "team_misc")]:
            params = dict(DASH_FILTERS, MeasureType=measure, PerMode="PerGame", Season=season, PaceAdjust="N", PlusMinus="N", Rank="N")
            h, rows = fetch("leaguedashteamstats", params, raw)
            tables[table].add(h, rows, SEASON=season)
        # Player tracking: catch-and-shoot vs pull-up, drives, passing.
        for measure, table in [("CatchShoot", "player_catch_shoot"), ("PullUpShot", "player_pull_up"), ("Drives", "player_drives"), ("Passing", "player_passing")]:
            params = dict(DASH_FILTERS, PtMeasureType=measure, PlayerOrTeam="Player", PerMode="Totals", Season=season)
            h, rows = fetch("leaguedashptstats", params, raw)
            tables[table].add(h, rows, SEASON=season)
        # Defense dashboard: opponents' shooting against each defender.
        for category, table in [("Overall", "defense_overall"), ("3 Pointers", "defense_3pt"), ("Less Than 6Ft", "defense_rim")]:
            params = dict(DASH_FILTERS, DefenseCategory=category, PerMode="Totals", Season=season)
            h, rows = fetch("leaguedashptdefend", params, raw)
            tables[table].add(h, rows, SEASON=season)
        print("  tracking done")

    for t in tables.values():
        t.write()
    print(f"\nDone. Send me the CSV files from {out}/ (not the raw/ folder).")


if __name__ == "__main__":
    main()
