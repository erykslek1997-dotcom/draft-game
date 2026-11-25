#!/bin/bash
# 2026-11-25 overnight: each TAL pipeline step switched off — clean RAPM profile test and the honest forecast.
for d in none usage bridge ceiling named reduced credit lowusage oldschool resume smallcap; do
  v=""; [ $d != none ] && v="TAL_DROP=$d"
  env $v npx tsx scripts/_defover.ts > /tmp/td.json
  echo "$d | $(python3 scripts/_defres4.py /tmp/td.json | awk '{print $NF" "$(NF-1)}' | tr '\n' ' ') | $(python3 scripts/_defres3.py /tmp/td.json | awk '{print $3,$4}') | prior $(env $v PRIOR=1 npx tsx scripts/_baseline.ts 2>&1 | grep -m1 'engine Overall' | awk '{print $3}')"
done
