"""
One-off conversion of the user's "Historical APM Grid.xlsx" (downloaded from
backpicks.com/Ben Taylor - real RAPM 1997-2017 blended with a regression-based
"Augmented Plus-Minus" reconstruction for 1977-1996, sourced from Harvey Pollack's guides)
into a flat per-season JSON array, matching the shape scripts/extractDarko.ts already
produces for DARKO (name/season/value rows) so the same buildXYearMap + avgXFieldForSpan
matching logic in the engine can be reused for a third data source.

Run once with `python scripts/extractHistoricalApm.py` whenever the source file changes -
this is a manual download (see [[no_scraping_stats_sites]]), not part of the Node build.
"""
import json
import re
from datetime import datetime

import pandas as pd

SRC_PATH = r"C:\Users\Eryks\Downloads\Historical APM Grid.xlsx"
OUT_PATH = "src/data/awards/historicalApm.json"


def season_label(col) -> str | None:
    """Column headers are inconsistent: 'Player', '1976-77 Au', '1996-97 NPI',
    '1997-98', '2000-01 NPI', and (an Excel auto-date-parse artifact) datetime objects
    for 2001-02..2011-12, then clean '2012-13'..'2016-17' strings again."""
    if isinstance(col, datetime):
        return f"{col.year}-{col.month:02d}"
    s = str(col)
    m = re.match(r"^(\d{4}-\d{2})\b", s)
    return m.group(1) if m else None


def main() -> None:
    df = pd.read_excel(SRC_PATH, sheet_name="All Scaled", header=0)
    rows = []
    skipped_cols = 0
    for col in df.columns[1:]:
        season = season_label(col)
        if season is None:
            skipped_cols += 1
            continue
        for name, value in zip(df["Player"], df[col]):
            if not isinstance(name, str) or pd.isna(value):
                continue
            rows.append({"name": name, "season": season, "apm": round(float(value), 2)})

    print(f"Parsed {len(rows)} player-seasons ({skipped_cols} unrecognized columns skipped).")
    seasons = sorted({r["season"] for r in rows})
    print(f"Season range: {seasons[0]} .. {seasons[-1]} ({len(seasons)} seasons)")
    print(f"Distinct players (by raw name): {len({r['name'] for r in rows})}")

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
