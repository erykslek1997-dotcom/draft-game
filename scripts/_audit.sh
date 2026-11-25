#!/bin/bash
# 2026-11-25: every Overall term / rule / fit penalty left out one at a time — real SRS (600 teams) and the
# forecast (windows before the season). Usage: bash scripts/_audit.sh > reports/audit.txt
cd "$(dirname "$0")/.." && export PATH=$PWD/node_modules/.bin:$PATH
run() { local lab="$1"; shift; local a=$(env "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}'); local b=$(env PRIOR=1 "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}'); echo "$lab | SRS $a | forecast $b"; }
run "BASE" X=1
for t in ballLoad lift handler certainty chem helio benchFloor era review benchOff benchRole; do run "overall -$t" OVR_DROP=$t; done
for t in eliteShooterCover paintCrowd threeBall offBallNoShot secondWeakPerim benchStarter extraPlaymaker noFloorGeneral; do run "review -$t" REV_DROP=$t; done
for t in bottleneck paint offBall shotFirst interior threeAndD; do run "fit -$t" FIT_DROP=$t; done
for t in hunt knee; do run "defense -$t" DEF_OFF=$t; done
run "offense -motion" OFF_MOTION_W=0
run "offense -helio bonus" OFF_HELIO_W=0
run "offense -helio penalty" OFF_HELIO_NEG=0
run "offense -weak starter" OFF_WEAK=0
run "glass back on" GLASS_DREB=1 GLASS_FOUL=1
