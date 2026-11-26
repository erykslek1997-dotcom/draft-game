#!/bin/bash
# 2026-11-25 overnight: gate thresholds grid on the clean profile test (scripts/_defres4.py).
for o0 in 30 40 45; do for o1 in 50 55 60 65; do
  [ $o1 -le $o0 ] && continue
  DEF_GATE_O0=$o0 DEF_GATE_O1=$o1 npx tsx scripts/_defover.ts > /tmp/gg.json
  echo "O0=$o0 O1=$o1 | $(python3 scripts/_defres4.py /tmp/gg.json | tr '\n' ' ') | $(python3 scripts/_defres3.py /tmp/gg.json)"
done; done
