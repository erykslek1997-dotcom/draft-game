#!/bin/bash
# 2026-11-26: two-primary-ball-handler calibration — variants on the repro table, best five, auditMetrics, AI picks.
for v in "BH_SHOOT_SRC=spotUp" "BH_SHOOT_SRC=spacing" "BH_SHOOT=0"; do
  echo "=========== $v"
  env $v npx tsx scripts/_ballrepro.ts 2>&1 | grep -v "^   " | cut -c1-75
  echo "-- best five top80:"; env $v timeout 2400 npx tsx scripts/_bestFive.ts 80 12 2>&1 | tail -3
  echo "-- best five top120:"; env $v timeout 3000 npx tsx scripts/_bestFive.ts 120 12 2>&1 | tail -2
  echo "-- auditMetrics:"; env $v timeout 2400 npx tsx scripts/auditMetrics.ts 2>&1 | grep -i -E "overall.*r |^r |srs|mechanic" | head -6
  echo "-- prior: $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "-- AI picks: $(env $v timeout 900 npx tsx scripts/testAiPickRegression.ts 2>&1 | tail -1)"
done
