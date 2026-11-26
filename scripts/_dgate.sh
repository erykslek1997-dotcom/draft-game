#!/bin/bash
# 2026-11-25 overnight: defense-credit gate grid — TAL vs RAPM bias by profile.
for v in "DEF_GATE_O1=0" "DEF_GATE_O1=55" "DEF_GATE_O1=60" "DEF_GATE_O1=65" "DEF_GATE_SPC=30" "DEF_GATE_O1=60 DEF_GATE_SPC=30" "DEF_GATE_O1=60 DEF_GATE_SPC=30 DEF_GATE_SPC_MULT=0"; do
  env $v npx tsx scripts/_defover.ts > /tmp/dg.json; echo "$v | $(python3 scripts/_defres.py /tmp/dg.json)"
done
