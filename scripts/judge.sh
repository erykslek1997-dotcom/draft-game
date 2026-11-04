#!/usr/bin/env bash
# 2026-11-04, fast calibration (the user: "szybsza i mniej obciążająca kalibracja"): the four judges
# in one command, at most three at a time (four cores: five at once ran each ~2x slower), quick by
# default. Prints the headline numbers and, with a saved run to compare, both side by side.
#
#   bash scripts/judge.sh <name> [--full] [--compare=<earlier name>]
#
# Plus the lineup judge (measureLineups: real five-man units, 250+ min quick / 150+ full).
# Quick: auditTeams every third team-season, measureScoreVsSim 3 leagues, measureRosterSense 4
# drafts (~3x faster). --full is the number of record before a merge. Output: reports/judge/<name>/.
set -u
cd "$(dirname "$0")/.."
NAME=${1:?usage: judge.sh <name> [--full] [--compare=<name>]}
shift
QUICK=1
COMPARE=""
for a in "$@"; do
  case $a in
    --full) QUICK=0 ;;
    --compare=*) COMPARE=${a#--compare=} ;;
  esac
done
OUT=reports/judge/$NAME
mkdir -p "$OUT"
export JUDGE_QUICK=$QUICK
start=$(date +%s)
printf '%s\n' auditTeams measureScoreVsSim auditDTal measureRosterSense measureLineups measureReviewFlags |
  xargs -P 3 -I{} sh -c 'npx tsx scripts/{}.ts > "'"$OUT"'/{}.txt" 2>&1 || echo "FAILED {}" >> "'"$OUT"'/{}.txt"'

summary() {
  local d=reports/judge/$1
  echo "SRS r (all)      $(grep -m1 -oE '^Overall vs SRS r [0-9.]+' "$d/auditTeams.txt" | awk '{print $NF}')"
  echo "SRS r (season)   $(grep -m1 -oE 'Season-centred.*r [0-9.]+' "$d/auditTeams.txt" | awk '{print $NF}')"
  echo "sim R2           $(grep -m1 -oE 'R² [0-9.]+' "$d/measureScoreVsSim.txt" | awk '{print $NF}')"
  echo "D-TAL r          $(grep -m1 -oE 'D-TAL  r [0-9.]+' "$d/auditDTal.txt" | awk '{print $NF}')"
  echo "lineups r        $(grep -m1 -oE 'Overall -> unit net   r [0-9.]+' "$d/measureLineups.txt" | awk '{print $NF}')"
  echo "AI rosters       $(grep -m1 -oE 'Overall [0-9.].*' "$d/measureRosterSense.txt")"
  [ -f "$d/measureReviewFlags.txt" ] && grep -E "^  [a-z23].*%" "$d/measureReviewFlags.txt" | sed -E 's/   e\.g\..*//'
  grep -h FAILED "$d"/*.txt 2>/dev/null
}
echo "== $NAME ($([ "$QUICK" = 1 ] && echo quick || echo full), $(( $(date +%s) - start )) s)"
summary "$NAME" | tee "$OUT/summary.txt"
if [ -n "$COMPARE" ] && [ -f "reports/judge/$COMPARE/summary.txt" ]; then
  echo "== $COMPARE"
  cat "reports/judge/$COMPARE/summary.txt"
fi
