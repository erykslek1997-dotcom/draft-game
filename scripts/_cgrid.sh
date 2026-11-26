#!/bin/bash
# 2026-11-26: center calibration — data-gap fixes (USG_EST, REV_SPOT_EST) on the judges.
for v in "X=0" "USG_EST=1 REV_SPOT_EST=1"; do
  echo "=========== $v"
  echo "-- auditMetrics:"; env $v timeout 2400 npx tsx scripts/auditMetrics.ts 2>&1 | grep -E "Overall vs judge r" | head -2
  echo "-- prior: $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') srs $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "-- AI picks: $(env $v timeout 900 npx tsx scripts/testAiPickRegression.ts 2>&1 | tail -1)"
  echo "-- best five top80:"; env $v timeout 2400 npx tsx scripts/_bestFive.ts 80 12 2>&1 | tail -3
  echo "-- best five top120:"; env $v timeout 3000 npx tsx scripts/_bestFive.ts 120 12 2>&1 | tail -3
done
