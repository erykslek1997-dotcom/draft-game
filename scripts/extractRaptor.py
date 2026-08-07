"""
One-off conversion of the user's FiveThirtyEight RAPTOR export ("historical_RAPTOR_by_player.csv" -
confirmed identical to "modern_RAPTOR_by_player.csv" on every overlapping player-season, to
float-precision noise only, so only the historical file is needed - it's a superset) into the same
flat name/season/value row shape darkoLookup.ts/pipmLookup.ts already consume.

Coverage: 1977-2022, `raptor_defense` column - a real, independent defensive plus-minus estimate
from a different methodology than DARKO's (built by FiveThirtyEight/Nate Silver's team). Added
2026-07-31 specifically to blend with DARKO's ddpm for a more robust defense correction - see
blendedDefenseLookup.ts.

Filtered to `mp >= MIN_MINUTES`: unfiltered, raw single-season RAPTOR readings for tiny samples are
wild (-43 to +62 in this export, vs a sane -6 to +8 once filtered) - confirmed directly: Pearson r
against DARKO's ddpm on overlapping player-seasons goes from 0.390 (unfiltered) to 0.696 (mp>=2000).
500 is a conservative middle ground (n=7,846, r=0.626) - low enough to keep genuine partial-season
call-ups.

Also filtered to `season >= MIN_SEASON` (1997-98, DARKO's own coverage start) - found necessary
2026-07-31 after the first blend attempt pushed John Stockton's pre-1997 span to the absolute TAL
ceiling (100) off RAPTOR alone. FiveThirtyEight's own RAPTOR methodology only has real play-by-
play/on-off signal from roughly the mid-to-late 1990s onward; the older portion of this "historical"
file is a box-score-driven reconstruction, not an independent real plus-minus reading - and there's
no way to verify it either way, since DARKO (the only other real source in this project) doesn't
exist before 1997-98 to cross-check against. Rather than trust an unverifiable reconstruction inside
a mechanism that can push a player to the hard cap, this correction only uses RAPTOR where it can
actually be checked against a second real source - the same principle historicalApm.json's own
docstring already applies (real RAPM 1997+ vs. a reconstructed "Augmented PM" before it).

Run once with `python scripts/extractRaptor.py` whenever the source file changes - manual download
(see [[no_scraping_stats_sites]]), not part of the Node build.
"""
import csv
import json

SRC_PATH = r"C:\Users\Eryks\Downloads\historical_RAPTOR_by_player.csv"
OUT_PATH = "src/data/awards/raptor.json"
MIN_MINUTES = 500
MIN_SEASON = 1998  # season end-year; excludes RAPTOR's pre-DARKO, unverifiable-methodology era


def season_label(raptor_season: str) -> str:
    """RAPTOR's `season` column is already the season END year (e.g. "2004" = the 2003-04
    season) - confirmed by cross-matching against darko.json's own end-year convention and
    getting a sane, expected correlation. Reformatted to "YYYY-YY" to match every other award
    source's convention (darko.json, historicalApm.json, pipm.json)."""
    end_year = int(raptor_season)
    return f"{end_year - 1}-{str(end_year)[2:]}"


def main() -> None:
    rows = []
    skipped_low_mp = 0
    skipped_pre_darko = 0
    with open(SRC_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            end_year = int(row["season"])
            if end_year < MIN_SEASON:
                skipped_pre_darko += 1
                continue
            mp = float(row["mp"])
            if mp < MIN_MINUTES:
                skipped_low_mp += 1
                continue
            rows.append({
                "name": row["player_name"],
                "season": season_label(row["season"]),
                "raptorDefense": round(float(row["raptor_defense"]), 3),
            })

    print(f"Parsed {len(rows)} player-seasons ({skipped_low_mp} skipped for mp < {MIN_MINUTES}, "
          f"{skipped_pre_darko} skipped for season < {MIN_SEASON}).")
    seasons = sorted({r["season"] for r in rows})
    print(f"Season range: {seasons[0]} .. {seasons[-1]} ({len(seasons)} seasons)")
    print(f"Distinct players (by raw name): {len({r['name'] for r in rows})}")

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
