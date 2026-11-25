#!/bin/bash
# 2026-11-25: season totals from pbpstats (api.pbpstats.com, Darryl Blackport), 2000-01 .. 2025-26, players and
# teams, regular season. One request per file, a pause between them, files already here kept. Raw files stay
# out of git (src/data/raw/pbpstats/, ~2.7 MB a season); scripts/buildPbpPlayer.ts keeps the fields we use.
cd "$(dirname "$0")/.." && mkdir -p src/data/raw/pbpstats
for y in $(seq 2000 2025); do s="$y-$(printf %02d $(( (y + 1) % 100 )))"
  for t in Player Team; do f="src/data/raw/pbpstats/$s-$t.json"
    [ -s "$f" ] && continue
    for try in 1 2 3; do
      curl -s -m 120 "https://api.pbpstats.com/get-totals/nba?Season=$s&SeasonType=Regular%20Season&Type=$t" -o "$f.tmp"
      if head -c 1 "$f.tmp" | grep -q '{'; then mv "$f.tmp" "$f"; break; fi
      rm -f "$f.tmp"; sleep 10
    done
    sleep 3
  done
done
ls src/data/raw/pbpstats | wc -l
