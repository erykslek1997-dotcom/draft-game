#!/bin/bash
# 2026-11-25: every pbpstats feature as an Overall term (PBP_FEAT / PBP_W) — real SRS and the forecast.
cd "$(dirname "$0")/.." && export PATH=$PWD/node_modules/.bin:$PATH
run() { local lab="$1"; shift; echo "$lab | SRS $(env "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}') | forecast $(env PRIOR=1 "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}')"; }
run BASE X=1
for f in atRim atRimShare liveTo assisted selfMade corner3 threeAcc longMidAcc onOff foulsDrawn fouls; do for w in 1 -1; do run "$f w=$w" PBP_FEAT=$f PBP_W=$w; done; done
