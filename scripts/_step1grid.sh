#!/bin/bash
# 2026-11-26, top-end plan step 2 (double counting): variants as args — SRS, forecast, target fives, pairs.
for v in "$@"; do
  echo "== $v"
  echo "   SRS $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')  prior $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "   $(env $v npx tsx scripts/_targetFives.ts | tail -1 | cut -c1-110)"
  echo "   $(env $v npx tsx scripts/_topcheck.ts | tail -1)"
done
