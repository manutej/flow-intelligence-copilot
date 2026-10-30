#!/usr/bin/env bash
# Main (6790d75) vs HEAD: npm run eval plus the interview problems, side by
# side. Exits 1 on any regression: a problem correct on main that is not
# correct on HEAD, or a changed answer whose numbers changed.
set -uo pipefail
MAIN=${MAIN:-6790d75}
REPO=$(git rev-parse --show-toplevel)
TMP=$(mktemp -d)
trap 'git -C "$REPO" worktree remove --force "$TMP/main" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
git -C "$REPO" worktree add --detach "$TMP/main" "$MAIN" >/dev/null 2>&1 || { echo "worktree failed"; exit 1; }
ln -s "$REPO/node_modules" "$TMP/main/node_modules"
(cd "$TMP/main" && npm run eval >"$TMP/eval-main.log" 2>&1); EM=$?
(cd "$REPO" && npm run eval >"$TMP/eval-head.log" 2>&1); EH=$?
node --no-warnings "$REPO/scripts/compare-main-run.ts" "$TMP/main" >"$TMP/main.jsonl" 2>"$TMP/main.err"
node --no-warnings "$REPO/scripts/compare-main-run.ts" "$REPO" >"$TMP/head.jsonl" 2>"$TMP/head.err"
python3 - "$TMP" "$EM" "$EH" "$MAIN" <<'PY'
import json, re, sys
tmp, em, eh, main = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
load = lambda f: {(r['set'], r['id']): r for r in map(json.loads, open(f'{tmp}/{f}'))}
M, H = load('main.jsonl'), load('head.jsonl')
def score(log):
    t = open(f'{tmp}/{log}').read()
    m = re.findall(r'(\d+)\s*/\s*(\d+)', t)
    return m[-1] if m else ('?', '?')
print(f'| check | main {main} | HEAD |\n|---|---|---|')
print(f'| npm run eval exit | {em} | {eh} |')
reg = 0; rows = []
for s in ['dev', 'test', 'heldout', 'operadic-interview-bank']:
    ks = [k for k in M if k[0] == s]
    if all(M[k]['correct'] is None for k in ks):
        same = sum(M[k]['answer'] == H.get(k, {}).get('answer') for k in ks)
        print(f'| {s} (no expected) answers identical | {same}/{len(ks)} | {same}/{len(ks)} |')
    else:
        cm = sum(M[k]['correct'] is True for k in ks); ch = sum(H.get(k, {}).get('correct') is True for k in ks)
        print(f'| {s} correct | {cm}/{len(ks)} | {ch}/{len(ks)} |')
    for k in ks:
        m, h = M[k], H.get(k)
        if h is None: reg += 1; rows.append((k, 'missing on HEAD')); continue
        if m['correct'] is True and h['correct'] is not True: reg += 1; rows.append((k, 'REGRESSION: correct on main only'))
        elif m['answer'] != h['answer']:
            same = m['numbers'] == h['numbers']
            kept = h['numbers'][:len(m['numbers'])] == m['numbers']
            if not kept and m['correct'] is not False: reg += 1
            how = 'same' if same else 'kept, more added' if kept else 'CHANGED'
            rows.append((k, f"wording changed, numbers {how}; main={m['correct']} head={h['correct']}"))
print(f'\nregressions: {reg}')
for k, why in rows: print(f'- {k[0]}/{k[1]}: {why}')
sys.exit(1 if reg or eh else 0)
PY
