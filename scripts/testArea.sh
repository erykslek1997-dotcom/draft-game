#!/usr/bin/env bash
# 2026-11-04, fast calibration: while iterating, only the tests a change can break; `npm run
# test:fast` (and the rest) once before a merge.
#
#   bash scripts/testArea.sh rotation|ai|score|positions|all-fast
set -u
cd "$(dirname "$0")/.."
case ${1:?usage: testArea.sh rotation|ai|score|positions|all-fast} in
  rotation) T="testSuggestedRotation testRotationEditable testRotationInvariants testClosingLineups" ;;
  ai) T="testAiPickRegression testAiBackupQuality testDraftRules" ;;
  score) T="testScoringLogic testFit testInsights testDefensiveHuntability" ;;
  positions) T="testRuntimePercentilesFresh testSuggestedRotation testAiPickRegression testFit" ;;
  all-fast) exec npm run test:fast ;;
  *) echo "unknown area: $1"; exit 2 ;;
esac
fail=0
for t in $T; do
  if npx tsx "scripts/$t.ts" > "/tmp/testArea-$t.log" 2>&1; then echo "ok   $t"; else echo "FAIL $t (/tmp/testArea-$t.log)"; fail=1; fi
done
exit $fail
