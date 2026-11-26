#!/bin/bash
# 2026-11-26: bigs' rebound / block adjustment grid, on top of the gate, no weak-offense rule, no named ceilings.
B="DEF_GATE_O1=55 DEF_WEAK_OFF=0 NAMED_OFF=1"
for v in "" "BIG_REB_W=0.6" "BIG_REB_W=1.2" "BIG_REB_W=0.8 BIG_BLK_W=0.5"; do
  env $B $v npx tsx scripts/_defover.ts > /tmp/bg.json
  echo "[$v] $(python3 scripts/_bigbias.py /tmp/bg.json) | prior $(env $B $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | srs $(env $B $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | $(env $B $v npx tsx scripts/_named.ts | grep -E 'Whiteside|Bradley|Ostertag' | cut -d'|' -f1,3 | tr '\n' ' ')"
done
