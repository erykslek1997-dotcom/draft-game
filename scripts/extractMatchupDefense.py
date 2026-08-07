"""
Extracts per-player-season real defensive matchup data from the user-supplied
"a lot of data" NBA tracking export (matchups_YYYY.csv, 2017-18 through 2024-25 regular
seasons only -- playoff files exist but aren't used here, matching how darko.json/raptor.json
are regular-season-based).

Each row in a source file is one (offensive player, defender) pairing within one game, with the
shots the offensive player took specifically while guarded by that defender. This script
aggregates across a whole season: for every defender, total matchup FGA/FGM faced, then computes
their real matchup FG% allowed against that season's real league-average matchup FG% (computed
from this same source, not an external baseline, so extraction quirks cancel out of the ratio --
same principle as threeVolumeEraScale/leagueThreeVolume.json).

Output value (`matchupDefense`) is (leagueAvgFgPct - playerFgPctAllowed) * 100, in percentage
points -- positive means the player allowed a lower FG% than league average that season, i.e.
real, direct on-ball defensive value. Sign convention matches ddpm/raptorDefense (positive=good).

Gated at >=150 matchup FGA faced in a season to avoid small-sample noise, same threshold used
elsewhere this session (playoff-performance's own min-FGA gate).

File-year is the season START year (confirmed empirically against real GAME_DATE values,
2026-08-01 -- e.g. matchups_2020.csv covers the 2020-21 season), so season_end = file_year + 1,
stored as the "YYYY-YY" string raptor.json/darko.json/pipm.json already use.
"""
import csv
import glob
import json
import re
import sys
from collections import defaultdict

DATA_DIR = r"C:\Users\Eryks\Desktop\a lot of data"
OUT_FILE = "src/data/awards/matchupDefense.json"
MIN_FGA = 150

player_season = defaultdict(lambda: {"fga": 0, "fgm": 0})
league_season = defaultdict(lambda: {"fga": 0, "fgm": 0})

files = sorted(glob.glob(f"{DATA_DIR}\\matchups_[0-9]*.csv"))
for fpath in files:
    m = re.search(r"matchups_(\d{4})\.csv$", fpath)
    file_year = int(m.group(1))
    end_year = file_year + 1
    with open(fpath, encoding="utf-8-sig", newline="") as f:
        r = csv.reader(f)
        header = next(r)
        idx = {name: i for i, name in enumerate(header)}
        i_fname = idx["matchups_first_name"]
        i_lname = idx["matchups_family_name"]
        i_fga = idx["matchup_field_goals_attempted"]
        i_fgm = idx["matchup_field_goals_made"]
        for row in r:
            fga = int(row[i_fga]) if row[i_fga] else 0
            fgm = int(row[i_fgm]) if row[i_fgm] else 0
            name = f"{row[i_fname]} {row[i_lname]}"
            d = player_season[(name, end_year)]
            d["fga"] += fga
            d["fgm"] += fgm
            ls = league_season[end_year]
            ls["fga"] += fga
            ls["fgm"] += fgm
    print(f"done {fpath}", file=sys.stderr)

out = []
skipped_small_sample = 0
for (name, end_year), d in player_season.items():
    if d["fga"] < MIN_FGA:
        skipped_small_sample += 1
        continue
    league = league_season[end_year]
    league_pct = league["fgm"] / league["fga"]
    player_pct = d["fgm"] / d["fga"]
    excess = round((league_pct - player_pct) * 100, 3)
    season_str = f"{end_year - 1}-{str(end_year)[-2:]}"
    out.append({"name": name.title(), "season": season_str, "matchupDefense": excess})

out.sort(key=lambda r: (r["name"], r["season"]))
with open(OUT_FILE, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)

print(f"wrote {len(out)} rows to {OUT_FILE}", file=sys.stderr)
print(f"skipped (fga < {MIN_FGA}): {skipped_small_sample}", file=sys.stderr)
vals = sorted(r["matchupDefense"] for r in out)
print(
    f"distribution: min {vals[0]:.2f} p10 {vals[len(vals)//10]:.2f} median {vals[len(vals)//2]:.2f} "
    f"p90 {vals[len(vals)*9//10]:.2f} max {vals[-1]:.2f}",
    file=sys.stderr,
)
