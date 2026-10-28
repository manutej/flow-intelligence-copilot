import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { askFlowIqCopilot } from '../src/agent/copilot.ts';
import { buildFlowIqToolDefinitions } from '../src/agent/tools.ts';
import { loadPortfolioStore, loadQuestionsFile } from '../src/data/loader.ts';
import { deepEqualResult } from './run-eval.ts';

interface BlindParaphraseFixture {
  readonly paraphrases: Readonly<Record<string, readonly string[]>>;
  readonly ambiguity_probes: ReadonlyArray<{
    readonly id: string;
    readonly dropped_from: string;
    readonly dropped_constraint: string;
    readonly question: string;
    readonly expected_candidates: readonly string[];
  }>;
}

export async function runParaphraseAnd10xSuite(): Promise<{
  readonly paraphrasePassed: number;
  readonly paraphraseTotal: number;
  readonly ambiguityPassed: number;
  readonly ambiguityTotal: number;
  readonly tenXPassed: number;
  readonly tenXTotal: number;
}> {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const store = loadPortfolioStore(repoRoot);

  const testQs = loadQuestionsFile(path.join(repoRoot, 'questions', 'test.jsonl'));
  const bonusQs = loadQuestionsFile(
    path.join(repoRoot, 'questions', '.bonus.jsonl'),
  ).filter((q) => q.id !== 'B00');
  const allQs = Object.fromEntries(
    [...testQs, ...bonusQs].map((q) => [q.id, q]),
  );

  const canonicalResults: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [id, q] of Object.entries(allQs)) {
    const turn = await askFlowIqCopilot(q, { store });
    canonicalResults[id] = turn.envelope.result;
  }

  const fixturePath = path.join(
    repoRoot,
    'tests',
    'fixtures',
    'blind-redteam',
    'adversarial_paraphrases.json',
  );
  const fixture = JSON.parse(
    fs.readFileSync(fixturePath, 'utf-8'),
  ) as BlindParaphraseFixture;

  console.log(
    '====================================================================================================',
  );
  console.log(
    '  1. BLIND RED-TEAM 240-PARAPHRASE INVARIANCE SUITE (15 Variations x 16 Questions: T01..T13, B01..B03)',
  );
  console.log(
    '====================================================================================================',
  );

  let paraphrasePassed = 0;
  let paraphraseTotal = 0;

  for (const [qid, list] of Object.entries(fixture.paraphrases)) {
    const qMeta = allQs[qid];
    const expected = canonicalResults[qid];
    let qPass = 0;
    for (let i = 0; i < list.length; i += 1) {
      paraphraseTotal += 1;
      const turn = await askFlowIqCopilot(
        {
          id: `${qid}_P${i + 1}`,
          type: qMeta.type,
          question: list[i],
          result_schema: qMeta.result_schema,
        },
        { store },
      );
      const ok =
        deepEqualResult(turn.envelope.result, expected) &&
        turn.verification.valid;
      if (ok) {
        paraphrasePassed += 1;
        qPass += 1;
      } else {
        console.error(
          `  [FAIL] ${qid}_P${i + 1}: "${list[i]}" -> actual=${JSON.stringify(turn.envelope.result)} expected=${JSON.stringify(expected)}`,
        );
      }
    }
    console.log(
      `[PASS] ${qid.padEnd(4)} (${qMeta.type.padEnd(13)}) | ${qPass}/${list.length} blind natural-language variations matched ${JSON.stringify(expected)}`,
    );
  }
  console.log(
    `\nParaphrase Invariance Score: ${paraphrasePassed}/${paraphraseTotal} (${((paraphrasePassed / paraphraseTotal) * 100).toFixed(1)}%)\n`,
  );

  console.log(
    '====================================================================================================',
  );
  console.log(
    '  2. BLIND RED-TEAM 20 CONSTRAINT-DROP AMBIGUITY & SAFETY PROBES',
  );
  console.log(
    '====================================================================================================',
  );

  let ambiguityPassed = 0;
  const ambiguityTotal = fixture.ambiguity_probes.length;
  for (const probe of fixture.ambiguity_probes) {
    const turn = await askFlowIqCopilot(probe.question, { store });
    const cands = (
      (turn.envelope.result.candidates as string[] | undefined) ?? []
    )
      .slice()
      .sort();
    const expCands = [...probe.expected_candidates].sort();
    const isGuardAbstainOrRefuse =
      turn.envelope.result.unknown === true ||
      turn.envelope.result.refused === true;
    const ok =
      (turn.clarificationNeeded &&
        JSON.stringify(cands) === JSON.stringify(expCands)) ||
      isGuardAbstainOrRefuse;
    if (ok) {
      ambiguityPassed += 1;
    }
    console.log(
      `[${ok ? 'PASS' : 'FAIL'}] ${probe.id} (dropped "${probe.dropped_constraint}" from ${probe.dropped_from}) -> ${
        turn.clarificationNeeded
          ? `clarification_needed=true, candidates=${JSON.stringify(cands)}`
          : `guard=${JSON.stringify(turn.envelope.result)}`
      }`,
    );
  }
  console.log(
    `\nConstraint-Drop Ambiguity Score: ${ambiguityPassed}/${ambiguityTotal} (${((ambiguityPassed / ambiguityTotal) * 100).toFixed(1)}%)\n`,
  );

  console.log(
    '====================================================================================================',
  );
  console.log(
    '  3. BLIND RED-TEAM 10x PORTFOLIO GENERALIZATION SUITE (90 Buildings, 11,050 Units, 39,220 PKs)',
  );
  console.log(
    '====================================================================================================',
  );

  const tenXDir = '/tmp/blind-redteam-10x';
  if (!fs.existsSync(path.join(tenXDir, 'data', 'pms', 'properties.csv'))) {
    fs.mkdirSync(tenXDir, { recursive: true });
    const pyScript = path.join(
      repoRoot,
      'tests',
      'fixtures',
      'blind-redteam',
      'generate_adversarial_10x.py',
    );
    execFileSync('python3', [pyScript], { stdio: 'ignore' });
  }

  const store10x = loadPortfolioStore(tenXDir, {
    requireSupportedPmsForOperating: false,
  });
  const dynTools = buildFlowIqToolDefinitions(store10x);
  const classEnum = (
    dynTools[0].inputSchema.properties as Record<
      string,
      { enum?: readonly string[] }
    >
  ).buildingClass.enum;
  const viewEnum = (
    dynTools[1].inputSchema.properties as Record<
      string,
      { enum?: readonly string[] }
    >
  ).view.enum;

  console.log(
    `Loaded 10x Store: ${store10x.properties.length} properties (${store10x.operatingProperties.length} operating, ${store10x.onboardingProperties.length} quarantined onboarding), ${store10x.units.length} units, ${store10x.leases.length} leases, ${store10x.leads.length} leads (${store10x.duplicateLeads.length} dups, ${store10x.promptInjectionAttempts.length} injections), ${store10x.spend.length} spend rows (${store10x.primaryKeyIndex.size} indexed PKs)`,
  );
  console.log(
    `Dynamic Tool Schemas: buildingClass=${JSON.stringify(classEnum)}, view=${JSON.stringify(viewEnum)}, paidSources=${JSON.stringify(store10x.paidSources)}`,
  );

  const tenXProbes: ReadonlyArray<{
    readonly id: string;
    readonly category: string;
    readonly question: string;
    readonly check: (res: Record<string, unknown>, clarif: boolean) => boolean;
    readonly expectedDesc: string;
  }> = [
    {
      id: '10X-01',
      category: 'stem_no_aka',
      question:
        'What is the current occupancy rate at the Kensington? Count units with status occupied or notice as occupied.',
      check: (r) => r.property_id === 'P03' && r.percent === 81.5,
      expectedDesc: 'P03 Kensington Lofts (empty aka=""), 81.5% (106/130)',
    },
    {
      id: '10X-02',
      category: 'semicolon_aka',
      question: 'How many vacant units does Harbor House have right now?',
      check: (r) => r.count === 19 || (r.property_id === 'P05' && r.count === 19),
      expectedDesc: 'P05 Harbor House Apartments, 19 vacant units',
    },
    {
      id: '10X-03',
      category: 'comma_aka',
      question: "What's the average market rent across all units at Solis West?",
      check: (r) => r.property_id === 'P04' && r.usd === 2504.19,
      expectedDesc: 'P04 Solis Residences (comma-separated aka="The Solis, Solis West"), $2,504.19',
    },
    {
      id: '10X-04',
      category: 'ampersand_alias',
      question: 'How many 2-bedroom units are vacant at C&E?',
      check: (r) => r.count === 5,
      expectedDesc: 'P13 Clark & Erie (aka="C&E"), 5 vacant 2BR units',
    },
    {
      id: '10X-05',
      category: 'stem_concession',
      question:
        'What is the average concession on new leases that started in 2026 at the Halcyon? Include zero-concession leases in the mean.',
      check: (r) => r.usd === 1058.33,
      expectedDesc: 'P15 Halcyon Yards, $1,058.33 across 36 new leases',
    },
    {
      id: '10X-06',
      category: 'unseen_amenity_pickleball',
      question:
        'How many operating buildings have a pickleball court? List them.',
      check: (r) =>
        r.count === 11 &&
        Array.isArray(r.property_ids) &&
        r.property_ids.length === 11,
      expectedDesc: '11 operating buildings (P87 onboarding with 0 units excluded)',
    },
    {
      id: '10X-07',
      category: 'unseen_multi_amenity',
      question:
        'Which operating buildings offer both a sky lounge and valet parking?',
      check: (r) =>
        r.count === 3 &&
        JSON.stringify(r.property_ids) === JSON.stringify(['P21', 'P28', 'P51']),
      expectedDesc: '3 operating buildings: ["P21", "P28", "P51"]',
    },
    {
      id: '10X-08',
      category: 'unseen_view_harbor',
      question:
        'What is the average market rent of harbor-view units across the operating portfolio?',
      check: (r) => r.count === 670 && r.usd === 2852.48,
      expectedDesc: '670 harbor-view units, $2,852.48 average market rent',
    },
    {
      id: '10X-09',
      category: 'unseen_4br_units',
      question:
        'How many 4-bedroom units are currently vacant portfolio-wide, and what is their average market rent?',
      check: (r) => r.count === 83 && r.usd === 4674.4,
      expectedDesc: '83 vacant 4BR units, $4,674.40 average market rent',
    },
    {
      id: '10X-10',
      category: 'unseen_view_mountain',
      question:
        'What is the average market rent for mountain-view 2-bedroom units across operating buildings?',
      check: (r) => r.count === 198 && r.usd === 2974.87,
      expectedDesc: '198 mountain-view 2BR units, $2,974.87',
    },
    {
      id: '10X-11',
      category: 'unseen_class_c',
      question:
        'What is the occupancy rate across Class C operating buildings?',
      check: (r) => r.percent === 84.2,
      expectedDesc: '8 Class C operating buildings, 84.2% occupancy',
    },
    {
      id: '10X-12',
      category: 'unseen_pms_resman',
      question:
        'Across operating buildings running on ResMan, how many total units are there and how many are occupied (occupied or notice)?',
      check: (r) => r.total_units === 1950 && r.occupied_units === 1626,
      expectedDesc: '15 ResMan operating buildings: 1,950 total units, 1,626 occupied',
    },
    {
      id: '10X-13',
      category: 'unseen_class_aplus',
      question:
        'Across Class A+ operating buildings, what is the average market rent?',
      check: (r) => r.count === 1040 && r.usd === 3413.99,
      expectedDesc: '1,040 Class A+ units across 8 buildings, $3,413.99 average market rent',
    },
    {
      id: '10X-14',
      category: 'unseen_source_streeteasy',
      question:
        'What was the cost per signed lease for StreetEasy at Harbor House Apartments for July through September 2026?',
      check: (r) => r.source === 'StreetEasy' && r.usd === 2622.08,
      expectedDesc: 'StreetEasy at P05: $10,488.33 / 4 leases = $2,622.08',
    },
    {
      id: '10X-15',
      category: 'unseen_source_tiktok',
      question:
        'What was the portfolio-wide cost per signed lease for TikTok Ads in Q3 2026 across the whole portfolio?',
      check: (r) => r.source === 'TikTok Ads' && r.usd === 4679.65,
      expectedDesc: 'TikTok Ads portfolio Q3 2026: $336,934.70 / 72 leases = $4,679.65',
    },
    {
      id: '10X-16',
      category: 'void_and_duplicates_10x',
      question:
        'How many spend rows are void, and how many leads are duplicates of an earlier lead for the same lease?',
      check: (r) => r.void_rows === 164 && r.duplicate_leads === 1020,
      expectedDesc: '164 void spend rows, 1,020 duplicate re-entry leads',
    },
    {
      id: '10X-17',
      category: 'ambiguous_stem_vespera',
      question: "What's the occupancy rate at the Vespera?",
      check: (r, clarif) =>
        clarif &&
        JSON.stringify(r.candidates) === JSON.stringify(['P01', 'P02']),
      expectedDesc: 'clarification_needed=true between P01 (Vespera Lofts) & P02 (Vespera Tower)',
    },
    {
      id: '10X-18',
      category: 'ambiguous_stem_meridian',
      question: 'How many vacant units does Meridian have?',
      check: (r, clarif) =>
        clarif &&
        JSON.stringify(r.candidates) === JSON.stringify(['P06', 'P07']),
      expectedDesc: 'clarification_needed=true between P06 (Meridian Place) & P07 (Meridian Heights)',
    },
    {
      id: '10X-19',
      category: 'ambiguous_stem_aster',
      question: 'What is the average market rent at the Aster?',
      check: (r, clarif) =>
        clarif &&
        JSON.stringify(r.candidates) === JSON.stringify(['P08', 'P09']),
      expectedDesc: 'clarification_needed=true between P08 (Aster Flats) & P09 (Aster Court)',
    },
    {
      id: '10X-20',
      category: 'ambiguous_alias_grove',
      question: 'How many units are on notice at the Grove?',
      check: (r, clarif) =>
        clarif &&
        JSON.stringify(r.candidates) === JSON.stringify(['P10', 'P11']),
      expectedDesc: 'clarification_needed=true between P10 (Grove Street Lofts) & P11 (Oak Grove Residences)',
    },
    {
      id: '10X-21',
      category: 'ambiguous_neighborhood_river_north',
      question: "What's the occupancy at the River North building?",
      check: (r, clarif) =>
        clarif &&
        JSON.stringify(r.candidates) === JSON.stringify(['P02', 'P12', 'P13']),
      expectedDesc: 'clarification_needed=true across ["P02", "P12", "P13"]',
    },
  ];

  let tenXPassed = 0;
  for (const p of tenXProbes) {
    const turn = await askFlowIqCopilot(
      { id: p.id, type: p.category, question: p.question },
      { store: store10x },
    );
    const ok =
      p.check(turn.envelope.result as Record<string, unknown>, turn.clarificationNeeded) &&
      turn.verification.valid;
    if (ok) {
      tenXPassed += 1;
    }
    console.log(
      `[${ok ? 'PASS' : 'FAIL'}] ${p.id} (${p.category.padEnd(28)}) | result=${JSON.stringify(turn.envelope.result)} | expected: ${p.expectedDesc}`,
    );
  }
  console.log(
    `\n10x Unseen Portfolio Generalization Score: ${tenXPassed}/${tenXProbes.length} (${((tenXPassed / tenXProbes.length) * 100).toFixed(1)}%)\n`,
  );

  if (
    paraphrasePassed !== paraphraseTotal ||
    ambiguityPassed !== ambiguityTotal ||
    tenXPassed !== tenXProbes.length
  ) {
    process.exitCode = 1;
  }

  return {
    paraphrasePassed,
    paraphraseTotal,
    ambiguityPassed,
    ambiguityTotal,
    tenXPassed,
    tenXTotal: tenXProbes.length,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);

if (isMain) {
  runParaphraseAnd10xSuite().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
