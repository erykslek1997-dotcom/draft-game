#!/bin/bash
# 2026-11-26: teammate lift's real-mates subtraction (LIFT_RM) — judges and the best five.
for v in "LIFT_RM=1" "LIFT_RM=0.5" "LIFT_RM=0"; do
  echo "=========== $v"
  echo "-- auditMetrics:"; env $v timeout 2400 npx tsx scripts/auditMetrics.ts 2>&1 | grep -E "Overall vs judge r" | head -2
  echo "-- prior: $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') srs $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "-- swap:"; env $v npx tsx scripts/_stockswap.ts 2>&1 | cut -c1-60 | head -4
  echo "-- best five top80:"; env $v timeout 2400 npx tsx scripts/_bestFive.ts 80 8 2>&1 | tail -2
done
