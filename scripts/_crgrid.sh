#!/bin/bash
# 2026-11-26: CREATOR_W grid — SRS, honest forecast, playoff series (scripts/_mu.ts).
for w in 0 1 2 3; do
  echo "CREATOR_W=$w | prior $(CREATOR_W=$w PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | srs $(CREATOR_W=$w npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}') | $(CREATOR_W=$w npx tsx scripts/_mu.ts 2>&1 | grep 'playoff teams')"
done
