"""
One-off conversion of the user's "PIPM Player Finder through 2021 - Database.csv"
(Jacob Goldstein's PIPM, basketball-index.com - independent methodology from the
Ben Taylor/backpicks source behind historicalApm.json) into the same flat name/season/value
row shape darkoLookup.ts and historicalApmLookup.ts already consume, so pipmLookup.ts can
reuse the same buildXYearMap + avgXFieldForSpan matching logic.

Coverage: 1973-74 through 2020-21, 3,542 players. Notably fills the exact gaps documented in
historicalApmLookup.ts's own docstring - Bird/Kareem/McHale had ZERO rows there, Magic only had
his 1995-96 comeback, Parish/Isiah/Wilkins only late-career - this source has their full primes.

Two data-quality issues in the raw export, both handled here:
- 71 (player, season) groups are exact byte-identical duplicate rows (copy-paste export
  artifact) - deduped by just taking one.
- 4 (player, season) groups are genuine multi-team splits (traded mid-season) - averaged
  weighted by minutes played (MP), same philosophy as blendedRealValueLookup.ts's
  coverage-weighted blend between sources.

Run once with `python scripts/extractPipm.py` whenever the source file changes - this is a
manual download (see [[no_scraping_stats_sites]]), not part of the Node build.
"""
import csv
import json
from collections import defaultdict

SRC_PATH = r"C:\Users\Eryks\Downloads\Copy of PIPM Player Finder through 2021 - Database.csv"
OUT_PATH = "src/data/awards/pipm.json"


def main() -> None:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    with open(SRC_PATH, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            groups[(row["Player"], row["Season"])].append(row)

    rows = []
    exact_dupe_groups = 0
    multi_team_groups = 0
    for (name, season), group in groups.items():
        if len(group) > 1 and all(r == group[0] for r in group):
            exact_dupe_groups += 1
            group = group[:1]
        elif len(group) > 1:
            multi_team_groups += 1

        total_mp = sum(float(r["MP"].replace(",", "")) for r in group)
        if total_mp > 0:
            pipm = sum(float(r["PIPM"]) * float(r["MP"].replace(",", "")) for r in group) / total_mp
        else:
            pipm = sum(float(r["PIPM"]) for r in group) / len(group)
        rows.append({"name": name, "season": season, "pipm": round(pipm, 2)})

    print(f"Parsed {len(rows)} player-seasons from {sum(len(g) for g in groups.values())} raw rows.")
    print(f"  {exact_dupe_groups} exact-duplicate row groups collapsed to one.")
    print(f"  {multi_team_groups} genuine multi-team-split groups averaged (minutes-weighted).")
    seasons = sorted({r["season"] for r in rows})
    print(f"Season range: {seasons[0]} .. {seasons[-1]} ({len(seasons)} seasons)")
    print(f"Distinct players (by raw name): {len({r['name'] for r in rows})}")

    with open(OUT_PATH, "w") as f:
        json.dump(rows, f)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
