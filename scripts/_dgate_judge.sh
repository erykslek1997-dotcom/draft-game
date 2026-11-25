#!/bin/bash
# 2026-11-25 overnight: defense-credit gate on the team judges.
for v in "DEF_GATE_O1=0" "DEF_GATE_O1=55" "DEF_GATE_O1=60"; do
  echo "$v | prior $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | srs $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | $(env $v npx tsx scripts/_defjudge.ts | sed -n 2p | cut -c1-30) | $(env $v npx tsx scripts/_offjudge.ts | sed -n 2p | cut -c1-30) | $(env $v N=3 npx tsx scripts/_starto.ts)"
done
