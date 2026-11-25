#!/bin/bash
# 2026-11-25: the main weights of Overall, one at a time x0.5 / x1.5 (and the offense mix) — real SRS (600) and forecast.
cd "$(dirname "$0")/.." && export PATH=$PWD/node_modules/.bin:$PATH
run() { local lab="$1"; shift; local a=$(env "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}'); local b=$(env PRIOR=1 "$@" npx tsx scripts/_baseline.ts 2>/dev/null | grep 'engine Overall' | awk '{print $3}'); echo "$lab | SRS $a | forecast $b"; }
run BASE X=1
for k in W_TAL W_BENCH W_FIT W_OFF W_DEF; do for m in 0.5 1.5; do run "$k x$m" $k=$m; done; done
run "W_OFF x1.5 W_DEF x0.75" W_OFF=1.5 W_DEF=0.75
run "OFF_MIX 0.5 (offense more O-TAL)" OFF_MIX=0.5
run "OFF_BENCH_SHARE 0.3" OFF_BENCH_SHARE=0.3
run "OFF_BENCH_SHARE 0.08" OFF_BENCH_SHARE=0.08
