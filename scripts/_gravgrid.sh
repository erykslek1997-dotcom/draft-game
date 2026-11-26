#!/bin/bash
# 2026-11-26: gravity (pbp on/off) in place of the old teammate lift — judges, Stockton swap, best five.
for v in "GRAVITY=0" "GRAVITY=1" "GRAVITY=1 GRAVITY_K=3000" "GRAVITY=1 GRAVITY_K=12000"; do
  echo "=========== $v"
  echo "-- auditMetrics:"; env $v timeout 2400 npx tsx scripts/auditMetrics.ts 2>&1 | grep -E "Overall vs judge r" | head -2
  echo "-- offense judge: $(env $v npx tsx scripts/_offjudge.ts | sed -n 2p | cut -c1-40)"
  echo "-- prior: $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') srs $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "-- swap:"; env $v npx tsx scripts/_stockswap.ts 2>&1 | cut -c1-60 | head -4
  echo "-- best five top80:"; env $v timeout 2400 npx tsx scripts/_bestFive.ts 80 8 2>&1 | tail -2
  echo "-- AI picks: $(env $v timeout 900 npx tsx scripts/testAiPickRegression.ts 2>&1 | tail -1)"
done
