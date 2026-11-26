#!/bin/bash
# 2026-11-26 (rate for the playoffs, RS as a guard): variants as args — real playoff series, SRS, forecast, target fives, pairs.
for v in "$@"; do
  echo "== $v"
  echo "   series $(env $v npx tsx scripts/_mu.ts 2>&1 | grep -m1 'playoff teams' | sed 's/.*vs Overall \([0-9.]*\).*/\1/')  SRS $(env $v npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')  prior $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
  echo "   $(env $v npx tsx scripts/_targetFives.ts | tail -1 | cut -c1-100) | $(env $v npx tsx scripts/_topcheck.ts | tail -1)"
done
