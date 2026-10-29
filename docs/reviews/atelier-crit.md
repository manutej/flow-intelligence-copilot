# Flow Intelligence Copilot CLI: Loom crit

Reviewer: ATELIER · Repo `main` @ `5487722`, copied to `/workspace/atelier-scratch/flow-cli/`. The original repo was not touched.
Captured with `script -qc` / a pty at `COLUMNS=72` and `100`, with colour and with `NO_COLOR=1`. Raw captures are in `/workspace/atelier-scratch/out/`.
Note: there is no `src/cli/` directory at this commit. Everything lives in `src/cli.ts`, `scripts/flow-106.ts` and `scripts/generate-answers.ts`.
Speed is not a problem. Every command returns in 150–420 ms, with no dead pauses and no in-app spinners.

Ranked worst-first by how bad each moment would look on camera.

---

## 1. Confident wrong answers stamped "PASS"

**Command:** `npm run ask -- "Which building has the most vacant units right now?"`, and in the REPL `Which building has the rooftop pool?` / `xyz nonsense`

```
Question       : Which building has the most vacant units right now?
Answer (Prose) : Across the matching operating buildings (Halsted &
                 Lake [P01]: 7, ... Kedzie Works [P06]: 14, ...), there
                 are 67 matching units.
Result (Schema): {"count":67}
Verified       : PASS (8 source row citations verified)
```
```
Question       : xyz nonsense
Tool Executed  : query_units_and_occupancy({})
Answer (Prose) : ... there are 1100 matching units.
Verified       : PASS (8 source row citations verified)
```

**Why it's clunky:** this is the scariest moment in the whole demo. The question asks *which building* and gets back a count. Garbage input returns all 1,100 units, and both get a green PASS. Anyone who improvises a question on camera will hit this. The answer is right there in the prose (Kedzie Works, 14), so it looks like the tool can't read its own output.

**Fix:**
- In `src/agent/intent.ts` `parseQueryIntent`, map "which building … most/least/highest" to a ranking intent.
- In `src/agent/planner.ts` `executeCompositionalPlan`, return the argmax as `{"property_id":"P06","count":14}`.
- When the intent has no filters and no matched entity, return the clarification gate ("I couldn't match that to a building, metric or window. Try: vacant units at the Tower"). Don't fall back to an unfiltered count.
- In `src/cli.ts` `printFormattedTurnOutput`, show `/ CHECK  citations only` rather than `PASS` when the planner fell back. PASS today means "citations exist", not "the question was answered".

---

## 2. The answer card is a wall of text that says everything three times

**Command:** `npm run ask -- "What did we spend on Facebook ads at Kedzie Works last quarter?"` (72 cols)

```
Tool Executed  : query_marketing_spend_and_funnel({"propertyIds":
                 ["P06"] , "sources": ["Facebook
                 Ads"],"period":"April to September 2026",
                 "startDate": "2026-04-01", "endDate": "2026-09-30",
                 "paidOnly": false, "appliedOnly": false,
                 "appliedWithoutTourOnly": false} )
Tool Output    : Window=2026-04-01 to 2026-09-30, ...
Answer (Prose) : In 2026-04-01 to 2026-09-30, total posted marketing
                 spend across the matching operating buildings was
                 $2847.00 USD (with void invoices at $0 and CAD
                 converted at 0.73 USD).
Result (Schema): {"usd":2847}
Source Rows    : properties:P06, spend:S0126
JSONL Line     : {"id":"ADHOC","answer":"In 2026-04-01 to 2026-09-30,
                 ... (6 more lines repeating the answer)
Verified       : PASS (2 source row citations verified)
```

**Why it's clunky:**
- A one-number answer takes about 25 lines. The 11-line banner adds more on every one-shot `ask`.
- The answer appears three times: as prose, as the schema result, and inside the JSONL line.
- Raw tool-argument JSON dominates the top of the card.
- The prose reads like a log line. It says "In 2026-04-01 to 2026-09-30" and "across the matching operating buildings" when only one building was asked about. "Last quarter" silently became a six-month window, and nothing on screen says so.

**Fix:** in `src/cli.ts` `printFormattedTurnOutput`, lead with the answer and drop the rest by default.
```
/ ANSWER   Kedzie Works spent $2,847 on Facebook Ads, Apr–Sep 2026.
/ RESULT   {"usd":2847}
/ SOURCES  2 rows · properties:P06, spend:S0126
/ CHECK    pass
```
- Move `Tool Executed`, `Tool Output` and `JSONL Line` behind `--trace`. `--json` already exists for the machine-readable form.
- In `runAskCommand`, print the banner only for `repl` and `doctor`, never for `ask`.
- In `planner.ts`, use the window label ("Apr–Sep 2026") rather than ISO pairs. Say "at Kedzie Works" when exactly one property matched. If "last quarter" really resolves to a six-month window, add `/ WINDOW  Apr–Sep 2026 (read "last quarter" as the reporting period)` so the reinterpretation is visible.

---

## 3. The wrapper rewrites JSON and money, putting wrong-looking data on screen

**Commands:** any `ask`, `ask T07`, and `npm run generate:answers`

```
                 {"count": 8} , "citations": ["properties: P07", "units:
                 U0829", "units: U0873", ...] }
```
```
               ($2915.86/lease, or $84, 560.00 / 29 leases) — would buy
  result    : {"pairs":[["P01", "Zillow"] , ["P03", "Apartment List"]
              , ["P05", "Apartments.com"] , ...
```

**Why it's clunky:**
- The display mangles the data. `properties:P07` becomes `properties: P07`, and `{"usd":2847}` becomes `{"usd": 2847} ,` with an orphaned comma at the start of a line.
- Worst of all, `$84,560.00` renders as `$84, 560.00`.
- A sharp viewer will think the JSONL file itself is malformed. It isn't. The file on disk is clean.
- Money formatting is also inconsistent across the same run. Some amounts have no thousands separator (`$2847.00`, `$46599.90`, `$8900.00`) and others do (`$11,035`, `$199,880`). The prose also has pluralisation slips such as "1 signed leases" (T03) and stray spaces such as "[P01] : 14" (T05).

**Fix:**
- `scripts/generate-answers.ts` `wrapText`: delete the `.replace(/([,}\]])(?=[^\s])/g, '$1 ')` pre-pass.
- `src/cli.ts` `wrapPlainText`: stop splitting long tokens on `,;:]}` and joining the pieces with spaces. Break at those characters without inserting a space, or hard-wrap only.
- For JSON values, print `JSON.stringify(x)` truncated to one line with `… (+n)`, or pretty-print with `JSON.stringify(x, null, 2)` under `--trace`.
- In `planner.ts`, add one `fmtUsd()` helper (`toLocaleString('en-US', {style:'currency', currency:'USD'})`) and a `plural()` helper, and use them everywhere.
- Side note, a correctness problem rather than a design one: regenerating `answers.jsonl` changes B01's committed answer from `$199,880` to `199,880`, which drops the `$` (see `git diff answers.jsonl` in the scratch copy). Don't show a diff on camera until that's fixed.

---

## 4. `doctor` / `status` falls apart at 72 columns

**Command:** `COLUMNS=72 npm run doctor` (`status` is the same output)

```
2. CROSS-TABLE DATA RECONCILIATION (6-TABLE INTEGRITY CHECKS E1..E6) [reconciled=true]
   • E1_PROPERTIES_TO_UNITS_COUNT     (properties -> units): 1 anomaly row(s) caught | blocking=false
   [T4] CAD Currency Conversion : 13 rows (12 posted S0126..S0184 on P06/P07 Facebook Ads + 1 void S0174) converted @ 1 CAD = 0.73 USD ($2,212.66 1BR avg @ P07 on T01)
   [T6] Lag, Rent & Reallocation: 70 cross-month lags, $1,955/mo notice rent gap, $46599.90 dead spend across 9 pairs -> +15 leases on Apartments.com; Small-Sample Guard windowInvariance=true
```

**Why it's clunky:**
- 28 of the 37 body lines are 73–191 characters wide. At 72 columns the terminal hard-wraps them flush-left under the bullets, so the column alignment the code works for is lost.
- The content is a jargon dump: `E1_PROPERTIES_TO_UNITS_COUNT`, `blocking=false`, `windowInvariance=true`, `Base64 aka`, `[reconciled=true]`.
- Four different header suffix styles appear: `[✓ VERIFIED]`, `[reconciled=true]`, `[⊘ QUARANTINED]`, and none.
- It's the "trust me" screen, and it reads like a debug log.

**Fix:** in `src/cli.ts` `runDoctorCommand`, render every row through `printWrappedField` with a hanging indent at the label column. Give each line one fact of at most about 60 characters:
```
/ DATA        3,858 rows · 6 tables · as of 2026-10-01
/ BUILDINGS   8 operating · 1 on hold (P09 Cornell Annex, 0 units)
/ TRAPS       6 caught
              void spend      10 rows held at $0
              CAD spend       13 rows converted at 0.73
              duplicate leads  9 rows merged
              prompt inject    1 lead note stripped (D01011)
/ MODELS      deterministic ready · 6 cloud/local not configured
/ EVALS       27/27 kit · 240/240 paraphrase · 600/600 bank
```
- Move the E1–E6 edge table and the primary-key lists behind `doctor --verbose`.
- Use one header style, `/ SECTION`, with no bracketed status.

---

## 5. The live-model label contradicts itself, and failures are silent

**Commands:** `npm run ask -- --llm "…"` (no key in env), and `XAI_API_KEY=<fake> npm run ask -- --provider xai "…"`

```
│ HARNESS: deterministic (flowiq-deterministic-v2.0) · MCP: ✓ wired        │
...
Harness        : xai (flowiq-deterministic-v2.0 (sealed vault live bridge ·
                 jev-1.13.0)) · native_tools · 158.79ms
```
```
Harness        : deterministic (grok-4) · deterministic_direct · 169.29ms
```

**Why it's clunky:**
- In the first run, the banner says deterministic and the card says xai, with a deterministic model name nested inside two levels of parentheses.
- In the second run, the provider was rejected (HTTP 400), and the card shows the contradictory "deterministic (grok-4)" with no hint that the live call failed.
- `fallbackReason` is computed in `model-harness.ts` but never printed.
- If Manu says "now let's run it on Grok", the screen can't tell the viewer what actually ran.

**Fix:**
- `src/agent/model-harness.ts` (`runSealedVaultOrCliLiveBridge` and the fallback return in `runModelHarnessTurn`): keep `modelUsed` as the real model id only, and put the route in a separate field.
- `src/cli.ts` `printFormattedTurnOutput`: always print one muted line, plus a gold note when a fallback happened.
```
/ ENGINE   deterministic · xai unavailable (HTTP 400), answered locally
```
- Drop "sealed vault live bridge" and "jev-1.13.0" from user-facing text.

---

## 6. The setup wizard overflows, nests its parentheses and ends abruptly

**Command:** `npm run setup` (real TTY, 72 cols). `--non-interactive`, or any piped stdin, skips the wizard.

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  FLOWIQ INTERACTIVE AGENT, LIVE /v1/models PROBE & MCP SETUP WIZARD         │
╰──────────────────────────────────────────────────────────────────────────────╯
  [1] xai            ○ NOT CONFIGURED    — xAI Grok API (Not configured (set XAI_API_KEY in /setup or .env.local))
  [6] local_openai   ○ NOT CONFIGURED    — Local OpenAI-Compatible Server (Raven / Flint / vLLM / llama.cpp / MLX) (Not running at http://127.0.0.1:8080/v1 (start local server or configure in /setup))
  [7] deterministic  ● LIVE API VERIFIED — FlowIQ Deterministic Sheaf & Compositional Engine (Zero-Key) (Ready in-process ...)
...
  Open Visual Client Dashboard (public/index.html) & Field Notebook in browser now? [Y/n]: n
```

**Why it's clunky:**
- The header box is hard-coded at 80 columns in gold. Every other box auto-sizes with a navy border. At 72 columns it wraps, and its right edge is off by one (79 against 80).
- The provider rows run 114–200 characters.
- It tells you to "set … in /setup" while you're already in /setup.
- The offline engine is badged "LIVE API VERIFIED".
- Saying "n" at Step 4 drops you at the shell with no closing line and no next step.

**Fix:** in `src/cli.ts` `runInteractiveSetupWizard`:
- Replace the box with `boxRow`/`getBoxInnerWidth`, or better, with a plain `/ SETUP` label plus a hairline.
- Make the rows `[1] xai           not configured    XAI_API_KEY`: three short columns, with the label and the detail on `--verbose` only.
- Badge deterministic as `ready (offline)`.
- Shorten the step titles to `/ 1 PROVIDER`, `/ 2 ENDPOINT`, `/ 3 MCP`, `/ 4 OPEN`.
- End with `/ DONE  provider deterministic · next: npm run ask -- "vacant units at the Tower"`.
- In `runSetupCommand`, also print `(non-interactive: stdin is not a TTY)` so the skip is visible.

---

## 7. Ellipses and a jagged box edge at 72 columns, including a misleading `B0=32…`

**Commands:** `npm run repl`, and any banner at 72 cols

```
│  ██║      ███████╗╚██████╔╝ ╚███╔███╔╝  Hold: P09 Cornell Annex (… │
│ POLICY : CAD=0.73 · Notice=true · Bucket=lease_start_date · B0=32… │
╭─ FLOWIQ TERMINAL USER INTERFACE (TUI) · COMMAND DECK ─────────────╮
│ [1] Ask / ID       Ask any question or ID (D01..D10, T01..T13, B0… │
│ [2] /setup         Live LLM API Probe (/v1/models), Key & MCP Wiz… │
```

**Why it's clunky:**
- The first screen of the demo has 11 truncated lines (2 in the banner, 9 in the deck).
- `B0=3250` truncates to `B0=32…`, which reads as a different number.
- The command-deck title row is one character short of every other row (69 against 70), so the right edge visibly steps in. The same bug affects `printValidationEnvelopeCard`.

**Fix:**
- `printTuiCommandDeck` and `printValidationEnvelopeCard`: `dashCount = W - title.length - 3`.
- `printBanner`: cut the copy so nothing needs truncating. Drop `Tickets FLOW-101..106` and `(0u)`, and move policy to `/policy`.
- Command-deck descriptions: at most 40 characters, for example `/doctor  data health and traps`.
- `truncateVisible`: never truncate numbers. Wrap instead.

---

## 8. Too many accent colours, and flow-106 ignores NO_COLOR

**Commands:** all of them. `NO_COLOR=1 npm run flow-106` still emits 41 escape sequences.

The colours in use, as an escape census: gold `210,158,61`, gold-bright `224,178,88`, emerald `52,211,153`, teal `75,163,166`, red, the navy border `42,62,102`, plus cyan `56,189,248` and slate `148,163,184` in flow-106. Emerald appears on every ✓, every citation list and every URL.

**Why it's clunky:**
- Ormus Chrome allows gold as the only accent. On screen there are gold, a second gold, green, teal and cyan, and the green competes with the gold for "this matters".
- Under NO_COLOR, `flow-106` dumps raw `\e[38;2;…m` codes, which also litter any piped or captured output.

**Fix:**
- `src/cli.ts` `ansi`: reduce to `ink`, `muted` and `gold`, plus `red` for FAIL only. Delete `emerald`, `teal` and `goldBright`.
- Success becomes ink text, with the gold reserved for the one value the eye should land on (the answer number).
- Borders and rules use `muted`.
- `scripts/flow-106.ts`: import the same `ansi` helper, or gate its constants on `NO_COLOR`/`!process.stdout.isTTY`, and drop cyan `C` and emerald `E`.

---

## 9. Glyph clutter, mixed rule characters, and a broken "6" in the flow-106 art

**Commands:** `npm run flow-106`, `npm run generate:answers`, banner and `doctor`

```
========================================================================
  | |    | |___| |__| | \  /\  /        | | |_| || _/ | 
  ...
+----------------------------------------------------------------------+
| "Cornell Annex (P09) is a 1927 Class B vintage building in Hyde      |
```

**Why it's clunky:**
- There are five rule styles across the commands: `╭─╮` rounded, `─` hairline, `═` block art, `====` and `+----+`.
- There are five bullet styles: `•`, `*`, `+`, `1.` and `[T1]`.
- There are about 12 status glyphs: `✓ ● ○ ◐ ⊘ ◆ ⋈ × … → -> ·`.
- The flow-106 ASCII "106" has a bug: `\_` inside the template literal loses its backslash, so the "6" renders as `|| _/ |`, one character short and visibly broken.
- The block-letter FLOW masthead is loud for a house style that asks for quiet.

**Fix:**
- Use one rule, the `─` hairline in `muted`. No boxes.
- Use one marker, the `/ ` micro-label.
- Status is a word, not a glyph (`ok`, `held`, `failed`).
- `printBanner`: replace the box and block art with a two-line masthead:
```
/ ORMUS × FLOW          8 buildings · 1,100 units · P09 on hold
──────────────────────────────────────────────────────────────────
```
- `scripts/flow-106.ts`: escape it as `\\_`, or delete the art and use the same masthead. Replace the `+---+` quote box with an indented gold-ruled quote (`│ ` in gold on the left only).
- `scripts/generate-answers.ts`: swap the `'='.repeat(72)` rules for the hairline.

---

## 10. Labels, casing and jargon change from command to command

**Commands:** `ask`, `doctor`, `setup`, `repl`

```
Answer (Prose) :      Result (Schema):      Source Rows    :
HARNESS:              POLICY :              Step 1/4 · Choose Your LLM / Agent Execution Provider:
1. PORTFOLIO DATA STORE HEALTH (6 RAW CSV EXPORTS) [✓ VERIFIED]
  • Wire Mode  : deterministic_direct
✓ 27/27 Kit · ✓ 240/240 RT        Tickets FLOW-101..106
```

**Why it's clunky:**
- There are four labelling systems: Title Case with a colon, UPPER with a colon (and `POLICY :` has a stray space), numbered ALL-CAPS headings, and Title Case step headings.
- Internal jargon leaks into the main view: RT, Kit, Sheaf, B0, Wire Mode, `deterministic_direct`, `HARNESS-ADHOC`, ticket ids.
- The same idea is called Source Rows, Source Citations, citations and Source.

**Fix:**
- Use one vocabulary across `printFormattedTurnOutput`, `printValidationEnvelopeCard`, `runDoctorCommand`, `runInteractiveSetupWizard` and `printBanner`: `/ QUESTION`, `/ ANSWER`, `/ RESULT`, `/ SOURCES`, `/ CHECK`, `/ ENGINE`.
- Pad labels to a 12-character column.
- Rename the user-facing terms: RT → "paraphrase", Kit → "kit questions", B0 → "prior spend", Harness → "Engine".
- Remove ticket ids from all user-facing surfaces.

---

## 11. npm preamble and spinner residue frame every command

**Commands:** every `npm run …` in a TTY

```
> flow-intelligence-copilot@2.0.0 ask
> node --no-warnings src/cli.ts ask Which building has the most vacant units right now?

...
⠙^[[1G^[[0K
```

**Why it's clunky:**
- Each command opens with two lines of npm plumbing that echo the question back. That's 87 characters, so it wraps at 72 columns.
- Each command ends with a spinner frame `⠙` and cursor codes left on the last line.
- It's the first and last thing on screen for every command.

**Fix (verified in scratch):** add a repo `.npmrc` with
```
loglevel=silent
progress=false
```
That removes both the preamble and the residue. Alternatively, record with `npm run -s`. For the Loom, an alias `flowiq` (`node --no-warnings src/cli.ts`) reads better still, because `npm run ask -- "…"` itself is clunky on camera.

---

## 12. The REPL prompt is long, the exit is chirpy, and piped input gets dropped

**Command:** `npm run repl`

```
flowiq [1-9, /setup, /ui, T01..B03, or question]> Which building has the rooftop pool?
...
  ● OPERATING  P01 Halsted & Lake         | class=A | pms=Yardi    | units=140/140 | aka=the Halsted, H&L
...
Exiting FlowIQ Copilot TUI. Goodbye!
```

**Why it's clunky:**
- The prompt is 50 characters, so any real question wraps at 72 columns.
- The prompt says `1-9` while the menu includes `0`.
- The numbered menu and the slash commands duplicate each other.
- `/buildings` rows are 98–105 characters, and `/harness` and `/decisions` are unstyled raw dumps.
- "Goodbye!" breaks the restrained tone.
- With piped stdin, only the first line (`T07`) was answered. The later lines and `exit` were swallowed, and the REPL ended without its exit line, so a scripted demo can't drive it.

**Fix:** in `src/cli.ts` `runReplCommand`:
- Make the prompt `flow › ` in gold, and show `/help` once below the deck.
- Drop the digit shortcuts, or show them only in `/help`.
- Format `/buildings` as `P01  Halsted & Lake        A  Yardi     140`, at most 60 characters.
- Make the exit line `/ SESSION CLOSED  3 questions · 0 failed`, in muted.
- Replace the `rl.question` loop with `for await (const line of rl)` (with a printed prompt) so buffered lines aren't lost.

---

## Suggested 5-minute demo order

Record after fixes 1–3, 7 and 11 at a minimum, at 100 columns, with the `flowiq` alias.

1. **0:00–0:30 · Masthead.** `flowiq repl`. Linger on the masthead and the deck for 3 seconds, then don't show them again.
2. **0:30–1:45 · Three asks that land.** These were all verified to answer correctly today:
   - `How many vacant units at the Tower?` shows alias resolution (P07, 8 units).
   - `Which building is the lakefront one with the rooftop pool, and how many vacant units does it have?` shows an amenity and alias match (P02, 7).
   - `How is the Annex doing?` shows the P09 quarantine. Trim the prose first, because it's 9 lines today.
3. **1:45–2:30 · Official item.** `T07` in the REPL shows the validation card with the schema match and sources. With fix 2, cut the JSONL and tools rows from view.
4. **2:30–3:30 · Trust.** `/doctor` with the fix 4 layout. Talk through "6 traps caught", especially the prompt-injection lead and the CAD conversion.
5. **3:30–4:15 · Engine swap.** `/setup`, choose deterministic and skip MCP and browser. Show the "ready (offline)" engine line, then one ask with `--provider xai` only if a key is live. Otherwise show the honest fallback line from fix 5.
6. **4:15–4:45 · Ninth House.** `npm run -s flow-106` as the story beat (it is a script, not a CLI subcommand), once the "6" glyph is repaired.
7. **4:45–5:00 · Close.** `/answers` → "17 lines written", then `exit` to the quiet session-closed line.

Avoid on camera until fixed: free-form "which building has the most …" questions (#1), any piped or scripted REPL input (#12), `git diff answers.jsonl` (the B01 `$`, #3), and `doctor` at 72 columns (#4).
