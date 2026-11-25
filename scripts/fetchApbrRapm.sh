#!/bin/bash
# 2026-11-25: single-season RAPM, 1996-97 .. 2018-19 (regular season and playoffs), from the APBRmetrics
# "NBA RAPM" site (Simon Zou and Raj Vir, 2019: basketball-analytics.gitlab.io/rapm-data). One request per
# file, a pause between them; files already here are kept. Rows: [rank, name, team, possessions, ORAPM, DRAPM, RAPM].
cd "$(dirname "$0")/.." && mkdir -p src/data/raw/apbrRapm
for y in $(seq 1996 2018); do s="$y-$(printf %02d $(( (y + 1) % 100 )))"
  for kind in "" "-playoffs"; do f="src/data/raw/apbrRapm/$s$kind-rapm.json"
    [ -s "$f" ] && continue
    curl -s -m 60 "https://basketball-analytics.gitlab.io/rapm-data/data/$s$kind-rapm.json" -o "$f" || rm -f "$f"
    sleep 2
  done
done
ls src/data/raw/apbrRapm | wc -l
