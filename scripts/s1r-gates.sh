#!/bin/bash
# S1R gates G1-G5 plus the seeded fuzz. Exits 1 if any gate fails (F-084).
cd "$(dirname "$0")/.."
unset OPENROUTER_API_KEY XAI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY FLOWIQ_FRAME_MODEL
TSC_BASELINE=${TSC_BASELINE:-9}
# Private logs per run (F-098): concurrent agents never share a path.
LOGS=$(mktemp -d "${TMPDIR:-/tmp}/s1r-gates.XXXXXX") || exit 1
chmod 700 "$LOGS"
echo "logs: $LOGS"
npm test >"$LOGS/test.log" 2>&1; ts=$?; t=$(grep -E "ℹ (pass|fail)|^✖ [A-Za-z]" "$LOGS/test.log" | sort -u | tr "\n" " ")
npm run eval >"$LOGS/eval.log" 2>&1; e=$?
npm run eval:paraphrase >"$LOGS/parity.log" 2>&1; p=$?
c=$(npx tsc --noEmit -p . 2>&1 | grep -c "error TS")
l=$(git diff --stat 58a8488 -- golden gold specs '*FREEZE*' GATES.lock sources.lock | wc -l)
# Seed 7311 is the reported gate (S1R.md:47); 4826 is a second seed.
SEED=7311 node --no-warnings scripts/s1r-fuzz.ts 2000 >"$LOGS/fuzz.log" 2>&1; z=$?
SEED=4826 node --no-warnings scripts/s1r-fuzz.ts 2000 >"$LOGS/fuzz2.log" 2>&1; z2=$?
fh=$(grep -o "Fair Housing: [0-9]*/[0-9]*" "$LOGS/eval.log")
echo "test exit $ts: $t| eval exit $e ($fh) | parity exit $p | tsc $c | protected-diff-lines $l | fuzz7311 exit $z $(tail -1 "$LOGS/fuzz.log") | fuzz4826 exit $z2 $(tail -1 "$LOGS/fuzz2.log")"
fhok=0; [[ "$fh" =~ ^Fair\ Housing:\ ([0-9]+)/([0-9]+)$ ]] && [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ] && fhok=1
[ $ts -eq 0 ] && [ $e -eq 0 ] && [ $p -eq 0 ] && [ "$c" -le "$TSC_BASELINE" ] && [ "$l" -eq 0 ] && [ $z -eq 0 ] && [ $z2 -eq 0 ] && [ $fhok -eq 1 ]
