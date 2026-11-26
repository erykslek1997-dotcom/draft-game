#!/bin/bash
# 2026-11-26 (the user: gravity from pbp on/off): team totals with each player on / off the floor, per team and
# season, from pbpstats (api.pbpstats.com, Darryl Blackport): Points, FGA, FTA. Raw files in src/data/raw/pbpOnOff
# (gitignored); scripts/buildGravity.ts turns them into src/data/gravity.json.
set -u
DIR="$(dirname "$0")/../src/data/raw/pbpOnOff"; mkdir -p "$DIR"
TEAMS=$(curl -s -m 60 "https://api.pbpstats.com/get-teams/nba" | python3 -c "import sys,json;print(' '.join(t['id'] for t in json.load(sys.stdin)['teams']))")
for y in $(seq 2000 2025); do s="$y-$(printf %02d $(( (y+1) % 100 )))"
  for t in $TEAMS; do for st in Points FGA FTA; do
    f="$DIR/$s-$t-$st.json"; [ -s "$f" ] && continue
    for try in 1 2 3; do curl -s -m 90 "https://api.pbpstats.com/get-on-off/nba/stat?Season=$s&SeasonType=Regular%20Season&TeamId=$t&Stat=$st" -o "$f.tmp" && grep -q '"results"' "$f.tmp" && mv "$f.tmp" "$f" && break; sleep $((try * 5)); done
    rm -f "$f.tmp"; sleep 0.3
  done; done
  echo "$s done: $(ls "$DIR" | grep -c "^$s")"
done
