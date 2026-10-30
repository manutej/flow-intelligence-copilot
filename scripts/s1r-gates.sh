#!/bin/bash
# S1R gates G1-G5 plus the seeded fuzz. Exits 1 if any gate fails (F-084).
cd "$(dirname "$0")/.."
unset OPENROUTER_API_KEY XAI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY FLOWIQ_FRAME_MODEL
TSC_BASELINE=${TSC_BASELINE:-9}
npm test >/tmp/g-test.log 2>&1; ts=$?; t=$(grep -E "ℹ (pass|fail)|^✖ [A-Za-z]" /tmp/g-test.log | sort -u | tr "\n" " ")
npm run eval >/tmp/g-eval.log 2>&1; e=$?
npm run eval:paraphrase >/tmp/g-par.log 2>&1; p=$?
c=$(npx tsc --noEmit -p . 2>&1 | grep -c "error TS")
l=$(git diff --stat 58a8488 -- golden gold specs '*FREEZE*' GATES.lock sources.lock | wc -l)
node --no-warnings scripts/s1r-fuzz.ts 2000 >/tmp/g-fuzz.log 2>&1; z=$?
fh=$(grep -o "Fair Housing: [0-9]*/[0-9]*" /tmp/g-eval.log)
echo "test exit $ts: $t| eval exit $e ($fh) | parity exit $p | tsc $c | protected-diff-lines $l | fuzz exit $z $(tail -1 /tmp/g-fuzz.log)"
fhok=0; [[ "$fh" =~ ^Fair\ Housing:\ ([0-9]+)/([0-9]+)$ ]] && [ "${BASH_REMATCH[1]}" = "${BASH_REMATCH[2]}" ] && fhok=1
[ $ts -eq 0 ] && [ $e -eq 0 ] && [ $p -eq 0 ] && [ "$c" -le "$TSC_BASELINE" ] && [ "$l" -eq 0 ] && [ $z -eq 0 ] && [ $fhok -eq 1 ]
