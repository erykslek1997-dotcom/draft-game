#!/usr/bin/env bash
# grid: OFF_BALL x OFF_TOP → control checks + fast offense judge
cd "$(dirname "$0")/.."
for b in 0 0.5 1; do for t in 0 0.1 0.2; do
  c=$(OFF_BALL=$b OFF_TOP=$t npx tsx scripts/controlCases.ts 2>&1 | grep checks)
  o=$(OFF_BALL=$b OFF_TOP=$t npx tsx scripts/_offjudge.ts 2>&1 | tail -1)
  echo "BALL=$b TOP=$t | $c | $o"
done; done
