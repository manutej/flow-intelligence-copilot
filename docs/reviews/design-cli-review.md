# Flow Intelligence Copilot CLI: usability and information-design review

Reviewed `main` @ 5487722. I worked from a copy at `/workspace/scratch/flow-cli-review/repo` and made no changes to the original repo.
Transcripts are in `/workspace/scratch/flow-cli-review/transcripts/` as `<run>.{tty80,tty60,nocolor80,piped}.txt`. The TTY runs went through `script` with `stty cols 80/60`. Width and ANSI counts are in `_measurements.txt` (ANSI stripped, display-width measured, npm `>` echo lines excluded).
Note: there is no `src/cli/` directory. The whole CLI lives in `src/cli.ts` (1,377 lines), plus `scripts/flow-106.ts` and `scripts/generate-answers.ts`.
This review covers Design's lens only. Craft and live-demo feel belong to ATELIER.

## Ranked issues (most impactful first)

### 1. There is no help, and any unknown input runs as a question
- **Command:** `flowiq --help`, `flowiq -h`, `flowiq frobnicate`, `npm run ask` (no args)
- **Observed:** `--help` prints the banner, then answers a built-in canned question ("Which building is the lakefront one with the rooftop pool…") and ends with `Verified : PASS` (help-long.nocolor80.txt). `-h` and `frobnicate` are each sent to the engine as the question text (`Question : -h`, `Question : frobnicate`). Both answer "1100 matching units" with PASS (help-short / unknown-sub). `ask` with no args also answers the canned question silently (ask-noargs). Every one of these exits 0 (`*.piped.txt` last line).
- **Fix:** Add a `help` subcommand and handle `-h`/`--help` before anything else. Unknown subcommands should go to stderr as `flowiq: unknown command "frobnicate". Run flowiq help.` with exit 2. `ask` with no question should print `usage: flowiq ask "<question>" | <ID>` and exit 2. Proposed help text, under 72 columns:
  ```
  FLOWIQ / PORTFOLIO COPILOT
  ────────────────────────────────────────────
  USAGE    flowiq <command> [options]

  ASK      ask "<question>" | <ID>   answer one question
           repl                       interactive session
  DATA     doctor                     data + harness health
           validate [ID]              27 official items
           answers                    regenerate answers.jsonl
  SETUP    setup [--provider P]       model + MCP config
           mcp-config                 print MCP JSON
  OPTIONS  --json  --llm  --provider P  --model M
           --cad-rate N  --exclude-notice  --bucket-by F
  ```
- **File:** `src/cli.ts:1313-1372` (dispatch: `--help` reaches `runAskCommand(repoRoot, args)` at 1371); `src/cli.ts:991-1009` (every `--x` token is dropped, and an empty question falls back to the canned default).

### 2. Nonsense, unmatched, and undefined inputs come back as confident PASS answers
- **Command:** `repl` → `/frobnicate`; `ask "How many vacant units does Lakeview Tower have?"`; `ask "...cost per signed lease on Facebook Ads at P06 last quarter?"`
- **Observed:** In the REPL, `/frobnicate` and `frobnicate` both return "1100 matching units … Verified : PASS" (repl-slow.nocolor80.txt). "Lakeview Tower" isn't in properties.csv, yet it silently resolves to `P07 (Printers Row Tower)` with no sign that this was a guess (repl.nocolor80.txt). For the P06 question, "last quarter" became `2026-04-01 to 2026-09-30` (six months), and a source with 0 signed leases is reported as "the lowest cost per signed lease … at $0.00", with `{"usd":0}` and `PASS` (ask.nocolor80.txt). The empty, ambiguous, and undefined cases all render exactly like a real answer.
- **Fix:** In the REPL, input starting with `/` that isn't a known command should print `Unknown command /frobnicate. Type /help.` and never reach the engine. In `printFormattedTurnOutput`, add an `INTERPRETED AS` row whenever a building or period was inferred, e.g. `INTERPRETED AS / "Lakeview Tower" -> P07 Printers Row Tower (partial match)` and `PERIOD / "last quarter" -> 2026-04-01..2026-09-30`. When the denominator is 0, the status row should read `RESULT / UNDEFINED (0 signed leases)` and not PASS. Reserve PASS for "a value was computed and cited".
- **File:** `src/cli.ts:1307` (REPL fallthrough to ask); `src/cli.ts:914-954` (only a `clarificationNeeded` status exists today); prose comes from `src/agent/copilot.ts`.

### 3. A piped `setup` silently overwrites the saved provider, and Ctrl+D in the wizard dumps a stack trace
- **Command:** `npm run setup < /dev/null`, and the interactive `npm run setup` cancelled with Ctrl+D
- **Observed:** With the saved config set to `xai / grok-4`, a piped `npm run setup` printed `✓ FlowIQ Harness & MCP Configuration Saved / Provider : deterministic` and rewrote the file (setup-clobber.config-before.json → setup-clobber.config-after.json). `setup --provider gpt5` also "saves" deterministic with a check mark (setup-provider-bad). In a TTY, EOF at `Select provider` prints a raw `AbortError: Aborted with Ctrl+D` plus a 10-frame stack (setup.nocolor80.txt).
- **Fix:** When stdin isn't a TTY and no `--provider` is given, write nothing. Print `flowiq setup: no terminal. Pass flags: flowiq setup --provider xai --model grok-4 [--write-mcp]` and exit 2. Catch `ABORT_ERR` in the wizard and print `Setup cancelled. Nothing saved.`, exit 130. Before overwriting a different saved provider, show `CHANGED / xai -> deterministic`.
- **File:** `src/cli.ts:808-856` (`!process.stdin.isTTY` ⇒ non-interactive defaults at 813, 822-823); `src/cli.ts:627-806` (no abort handling).

### 4. Bad flag values and provider fallbacks are swallowed
- **Command:** `ask --cad-rate abc --bucket-by nope "occupancy at P01"`, `ask --provider gpt5 …`, `ask --llm …` with no `XAI_API_KEY`
- **Observed:** `--cad-rate abc` reaches the banner as `CAD=NaN`, and `--bucket-by nope` is ignored (badflag.nocolor80.txt). `--provider gpt5` drops to deterministic with no Harness row (ask-provider-bad). `--llm` without a key prints `Harness : xai (flowiq-deterministic-v2.0 (sealed vault live bridge · jev-1.13.0))`. That line mixes the xai provider with the deterministic model id, and nowhere says a fallback happened (ask-llm-nokey). The harness computes `fallbackReason`, but the CLI never prints it. All of these exit 0.
- **Fix:** Validate flags up front and exit 2 with `flowiq: --provider must be one of xai, anthropic, openai, openrouter, ollama, local, deterministic (got "gpt5")`, and likewise `--cad-rate must be a number (got "abc")` and `--bucket-by must be lease_start_date | lead_created_date`. Add a row `FALLBACK / <turn.fallbackReason>` whenever it's non-null, and don't carry the saved deterministic model id over to a cloud provider.
- **File:** `src/cli.ts:963-980` (parse with no validation); `src/cli.ts:288-300` (`normalizeProviderId` returns undefined silently); `src/cli.ts:876-897, 1043-1048` (meta omits `fallbackReason`); `src/agent/model-harness.ts:658, 692, 713`.

### 5. Non-TTY output: ANSI leaks into pipes, `flow-106` ignores NO_COLOR, and the piped REPL drops lines
- **Command:** every command `| cat`; `NO_COLOR=1 npm run flow-106`; `printf '…\nhelp\n/frobnicate\nexit\n' | npm run repl`
- **Observed:** Piped stdout keeps 142–252 escape sequences per run (ask.piped 168, doctor.piped 186, repl.piped 252). NO_COLOR is the only off switch. `flow-106` emits 116 sequences even with `NO_COLOR=1` (flow106.nocolor80). The piped REPL answered only the first line, dropped `help`, `/frobnicate`, and `exit`, then exited 0 without the goodbye (repl.piped.txt; repl-slow.piped.txt processed only `help`).
- **Fix:** Use one shared predicate: `const COLOR = !!process.env.FORCE_COLOR || (process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb")`. Put it in a small `src/cli/style.ts` that both `src/cli.ts` and `scripts/flow-106.ts` import. When `!process.stdin.isTTY`, the REPL should read with `for await (const line of rl)`, skip the prompt, banner, and command deck, and handle every line.
- **File:** `src/cli.ts:35-48`; `scripts/flow-106.ts:1-7` (raw escape constants, no check); `src/cli.ts:1122-1135` (`rl.question` loop).

### 6. Output overruns 80 columns, and at 60 columns the banner overflows and truncates
- **Command:** `doctor` / `status`, `setup` (wizard and flag summary), and any command at COLUMNS=60
- **Observed:** `doctor` has 27 lines over 80 columns, the longest at 191, in every mode including tty60 (`_measurements.txt`). Wizard rows reach 200 columns (`[6] local_openai ○ NOT CONFIGURED — Local OpenAI-Compatible Server (Raven / Flint / …)`), and the setup summary reaches 93. At 60 columns the box is still 66 wide because the inner-width floor is 64. It also silently cuts content: `MCP: ✓ w…`, `✓ 27/27 Kit · ✓ 240/2…`, `Hold: P09 Cornell Ann…` (ask.tty60.txt).
- **Fix:** Send doctor and wizard rows through `printWrappedField` with a hanging indent, and break the doctor detail into label/value rows (`T3 / VOID SPEND / 10 rows / $11,500.80 raw -> $0.00`). Change `getBoxInnerWidth` to `Math.min(76, cols - 4)` with no floor. Below 64 columns, drop the block logo and print `FLOWIQ / ORMUS × FLOW COPILOT` on one line. Status values should wrap and never be truncated with `…`.
- **File:** `src/cli.ts:54-57` (floor 64); `src/cli.ts:97-108` (truncation); `src/cli.ts:548-624` (doctor); `src/cli.ts:661-672, 775` (setup).

### 7. The "JSONL Line" field can't be copied: the wrapper rewrites the JSON
- **Command:** `ask`, `ask T01`, `repl`
- **Observed:** The wrapper splits tokens after `, : ] }` and rejoins them with spaces. The printed line therefore reads `"citations": ["properties: P06", "spend: S0126" …] }` and `{"count": 8} ,`, while the real values are `properties:P06` and `{"count":8}` (compare ask.nocolor80.txt with ask-json.piped.txt). At 60 columns it also breaks inside identifiers (`({"propert` / `yIds"` in ask.tty60.txt). A field named as the literal JSONL output produces citation strings that don't match.
- **Fix:** Never reflow JSON. Print the JSONL line unwrapped on its own line under a `JSONL /` label after the closing rule, or drop it from the default view and point to `--json`. If it must be wrapped, break only at character boundaries and insert nothing.
- **File:** `src/cli.ts:59-95` (`wrapPlainText` sub-splitting at 69); `src/cli.ts:936-946`, `418-420`.

### 8. One-shot output buries the answer under the banner and repeated fields
- **Command:** `ask`, `doctor`, `validate`, `setup`
- **Observed:** Every one-shot command opens with the same 12-line block-logo banner. In `ask` the answer starts at line 30 of 50 (ask.nocolor80.txt). The same answer then appears three times (Answer (Prose), Result (Schema), JSONL Line). The tool trace repeats the whole question inside `find_properties({"queryText": …})`. The banner's `✓ 27/27 Kit · ✓ 240/240 RT` and doctor section 5's `[✓ VERIFIED]` are hard-coded strings and don't reflect anything run (src/cli.ts:197, 611-618).
- **Fix:** Print the banner only in `repl`. One-shot commands get a single header line, `FLOWIQ / ASK / deterministic / policy CAD 0.73`. Use this order: `ANSWER`, `RESULT`, `SOURCES`, `CHECK`. Put `TOOL`, `TOOL OUTPUT`, and `JSONL` behind `--verbose`. Either remove the hard-coded pass counts or label them `LAST RUN / <date>` and read them from a results file.
- **File:** `src/cli.ts:1042, 1058, 538, 816, 821, 1338` (banner calls); `src/cli.ts:887-955` (field order); `src/cli.ts:197, 611-624`.

### 9. Command names sprawl: too many aliases, two answer generators, and hidden or mis-pointed commands
- **Command:** `package.json` scripts, `repl` command deck, `generate:answers` vs `answers`
- **Observed:** `package.json` defines 45 scripts, many of them duplicates: `answer` = `generate` = `generate-answers` = `generate:answers`; `build-ui` = `build:ui`; `build-dashboard` = `build:dashboard`; `report` = `generate-reports` = `generate:reports`; `mcp:smoke` = `mcp:demo` = `test:mcp`; `eval:paraphrase` = `eval:10x`; `bank:600` = `eval:600`. `doctor` and `status` print identical output (doctor/status transcripts), and `setup` = `login` = `init`. `npm run generate:answers` and `flowiq answers` both write answers.jsonl but look completely different (genanswers.nocolor80: `=` rules, lowercase `result :`; the cli version uses box rules and a `[T01] JSONL :` label). The REPL has commands missing from the deck (`/harness`, `/workflow`), and `/buildings` and `/decisions` are only mentioned inside the `/quit` row. Provider hints in `doctor` and `setup` say `configure in /setup`, which is REPL syntax and doesn't work in a shell (doctor.nocolor80 §4).
- **Fix:** Keep one name per verb, using the colon style (`generate:answers`, `build:ui`, `eval:paraphrase`, `mcp:smoke`), and drop the rest. Make `status` a one-screen summary (harness, MCP, policy, last eval) so it differs from `doctor`. Have `generate:answers` call the same renderer as `flowiq answers`. List every REPL command in the deck. Hints should name the command for the current context: `run: npm run setup` in the shell and `/setup` in the REPL.
- **File:** `package.json` scripts; `src/cli.ts:1320-1336`; `src/cli.ts:217-286` (deck); `src/cli.ts:1292-1305` (hidden commands); `src/agent/model-harness.ts:688, 1267, 1279`; `scripts/generate-answers.ts:40-45, 108-139`.

### 10. Ormus Chrome deviations: extra accent colors, symbol glyphs, heavy boxes, mixed label styles
- **Command:** all
- **Observed:** The palette includes emerald, teal, red, ink, and a blue border (`src/cli.ts:38-47`), and flow-106 adds cyan `56,189,248` plus emerald (`scripts/flow-106.ts:3-4`). Glyphs in the output include `✓ ◆ ● ◐ ○ ⊘ • █ ╔ ╗ ╭ ╮`, with a full-block ASCII logo (`_measurements.txt` glyph column). Boxes use rounded heavy frames, not hairline rules. Labels are title case with padded colons (`Question       :`, `Answer (Prose) :`), not mono uppercase with `/` separators. Each surface has its own rule style: box frames in cli.ts, `====` in generate-answers, and `====` plus `+----+` in flow-106. flow-106's ASCII art is also broken on row 5: `\_/` in the template literal renders as `_/` (flow106.nocolor80, `scripts/flow-106.ts:15`).
- **Fix:** Use gold as the only accent. Status goes in words (`PASS`, `FAIL`, `NOT CONFIGURED`, `QUARANTINED`), with gold for emphasis and plain or dim text otherwise. Remove `✓ ◆ ● ◐ ○ ⊘` and the block logo. Use a single hairline `─` rule above and below a section, with no side borders. Write labels as `ANSWER /`, `RESULT /`, `SOURCES /`, `CHECK /` and sections as `DOCTOR / DATA STORE`. Put all three surfaces on the shared `src/cli/style.ts` from issue 5. Escape the backslash in flow-106 (`\\_/`).
- **File:** `src/cli.ts:37-48, 159-214, 217-286, 549-611, 640-646`; `scripts/flow-106.ts:1-63`; `scripts/generate-answers.ts:111-139`.

## Runs captured
flow-106; ask (P06 Facebook CPL); ask with no args; ask T01; ask --json; ask --llm with no key; ask --provider gpt5; ask with bad --cad-rate/--bucket-by; --help; -h; unknown subcommand; doctor; status; setup (TTY wizard + EOF); setup --provider gpt5; piped setup clobber with before/after config; generate:answers; repl (piped batch and slow-fed TTY: question, help, /frobnicate, frobnicate, /buildings, blank, exit). `ui` was skipped because it opens a browser.
