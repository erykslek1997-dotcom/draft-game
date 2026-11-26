#!/bin/bash
# 2026-11-26: TAL pulled toward RAPM where they disagree (option C) — grid.
for v in "TAL_RAPM_W=0" "TAL_RAPM_W=0.25" "TAL_RAPM_W=0.5" "TAL_RAPM_W=0.5 TAL_RAPM_GAP=15"; do
  echo "[$v] prior $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | srs $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | $(env $v npx tsx scripts/_ws.ts | head -2 | awk '{print $1,$5}' | tr '\n' ' ')"
done
