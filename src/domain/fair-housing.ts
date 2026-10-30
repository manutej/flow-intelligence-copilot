import { FIXED } from './vocabulary.ts';
/**
 * Fair Housing request classifier (FLOW-103).
 *
 * A request is refused when it combines a discriminatory ACTION with a
 * PROTECTED CLASS or a close proxy for one. Neither alone is enough:
 * "how many three-bedroom units are vacant? we get family inquiries"
 * names a family but asks for nothing discriminatory, and "exclude void
 * invoices" is an exclusion with no protected class. Inclusive wording
 * ("welcomes families with children") clears its own clause only, so one
 * discriminatory clause refuses the whole request.
 *
 * Classes follow the federal Fair Housing Act (42 U.S.C. 3604), the
 * Illinois Human Rights Act (775 ILCS 5/), and the Chicago Fair Housing
 * Ordinance (Municipal Code 5-8), which add age, marital status, source
 * of income, military status, and others.
 */

export type FairHousingAction = 'targeting' | 'exclusion' | 'steering' | 'preference' | 'differential';

export interface ProtectedClassRule {
  readonly protectedClass: string;
  readonly legalBasis: string;
  readonly pattern: RegExp;
}

const FHA = 'Fair Housing Act, 42 U.S.C. § 3604';
const IHRA = 'Illinois Human Rights Act (775 ILCS 5/3-102)';
const CHICAGO = 'Chicago Fair Housing Ordinance (Municipal Code § 5-8-030)';

export const PROTECTED_CLASS_RULES: readonly ProtectedClassRule[] = [
  {
    protectedClass: 'familial status',
    legalBasis: FHA,
    pattern:
      /\b(famil(?:y|ies)|children|child|kids?|minors|toddlers?|little\s+ones|babies|baby|prams?|buggies|moms?|mothers?|kid[-\s]?free|teen(?:ager)?s?|pregnan\w*|expecting\s+mothers?|strollers?|school[-\s]?age|parents?|adults?[-\s]only|no[-\s]kids|child[-\s]?free|empty[-\s]?nesters?|dinks?)\b/i,
  },
  {
    protectedClass: 'race or color',
    legalBasis: FHA,
    pattern:
      /\b(race|racial\w*|color(?:ed)?\s+(?:people|tenants|renters|residents|applicants)|people\s+of\s+color|blacks?|whit(?:es?|er|est)|asian|hispanic|latin[oax]s?|african[-\s]american|caucasian|native\s+americans?|indigenous|pacific\s+islanders?|biracial|mixed[-\s]race|ethnic\w*|minorit(?:y|ies)|demographics?|[\w]+[-\s]skinned|skin\s+(?:colou?r|tone)s?)\b/i,
  },
  {
    protectedClass: 'national origin, ancestry, or language',
    legalBasis: `${FHA} and ${IHRA}`,
    pattern:
      /\b(national\s+origin|ancestry|immigrants?|foreign(?:ers)?|citizens?(?:hip)?|non[-\s]?citizens?|undocumented|green\s+card|accents?|english[-\s]speak\w*|(?:first|native)\s+language|mother\s+tongue|perfect\s+english|from\s+(?:mexico|china|india|poland|another\s+country|abroad)|native\s+english|speaks?\s+(?:good\s+|fluent\s+)?english|spanish[-\s]speak\w*|non[-\s]english|esl|mexican\w*|indian|chinese|polish|arab\w*|middle\s+eastern|puerto\s+ricans?|somalis?|nigerians?|koreans?|vietnamese|filipin[oa]s?|russians?|ukrainians?|haitians?|syrians?|afghans?|(?:people|tenants|renters|applicants|callers|families)\s+from\s+(?!the\s+(?:website|portal|ils|ad)\b)[a-z]+)\b/i,
  },
  {
    protectedClass: 'religion',
    legalBasis: FHA,
    pattern:
      /\b(religio(?:n|us)|church[-\s]?go\w*|churchgo\w*|church|christians?|catholics?|protestants?|muslims?|islamic|jewish|jews?|hindus?|sikhs?|mormons?|evangelicals?|orthodox|hasidi?c?m?|amish|quakers?|jehovah\w*|buddhists?|atheists?|synagogue|mosque|temple[-\s]go\w*|faith[-\s]based|devout|pray\w*|hijabs?|turbans?|yarmulkes?|kippahs?)\b/i,
  },
  {
    protectedClass: 'sex, gender identity, or sexual orientation',
    legalBasis: `${FHA} and ${IHRA}`,
    pattern:
      /\b(men|women|males?|females?|guys|ladies|gentlemen|gender|sex|transgender|trans\s+(?:people|tenants|renters)|gay|lesbians?|lgbt\w*|queer|sexual\s+orientation)\b/i,
  },
  {
    protectedClass: 'disability',
    legalBasis: `${FHA}(f)`,
    pattern:
      /\b(disab(?:ility|ilities|led)|handicap\w*|wheelchairs?|walkers?|canes?|crutches|mobility\s+aids?|service\s+(?:animals?|dogs?)|emotional\s+support\s+animals?|esas?|blind|deaf|mental(?:ly)?\s+ill\w*|mental\s+health|hiv|aids\s+patients?|recovering\s+addicts?)\b/i,
  },
  {
    protectedClass: 'age',
    legalBasis: `${IHRA} and ${CHICAGO}`,
    pattern:
      /\b((?:over|under)\s+\d{2}(?!\s*(?:lbs?|pounds?|kg|kilos?|sq|sqft|square|feet|ft|%|percent|units?|dollars?|usd|\$|k\b|days?|months?|minutes?))|(?:older|younger)\s+than\s+[\w-]+|born\s+(?:before|after|in)\s+\d{4}|mature\s+(?:people|tenants|renters|residents|applicants)|age[sd]?\s+\d{2}|seniors?|elderly|older\s+(?:people|tenants|renters|residents|applicants|adults)|retirees?|young(?:er)?\s+(?:people|tenants|renters|residents|applicants|professionals|adults|crowd)|millennials?|gen[-\s]?z|boomers?)\b/i,
  },
  {
    protectedClass: 'marital status',
    legalBasis: `${IHRA} and ${CHICAGO}`,
    pattern:
      /\b(marital\s+status|married(?:\s+couples?)?|unmarried|singles|single\s+(?:people|tenants|renters|women|men|mothers?|fathers?|parents?)|divorc\w*|widow\w*|couples?)\b/i,
  },
  {
    protectedClass: 'source of income',
    legalBasis: `${CHICAGO} and ${IHRA}`,
    pattern:
      /\b(section[-\s]?(?:8|eight)|(?:housing|rental|public)\s+assistance|on\s+assistance|subsidi[sz]ed|housing\s+choice\s+vouchers?|vouchers?|voucher\s+holders?|hcv|welfare|ssi|ssdi|disability\s+income|source\s+of\s+income)\b/i,
  },
  {
    // Redlining: marketing kept to some neighborhoods and away from others
    // is the usual proxy for race and national origin.
    protectedClass: 'race or national origin (neighborhood proxy)',
    legalBasis: FHA,
    pattern:
      /\b(?:campaigns?|ads?|advertis\w*|marketing|mailers?|mailings?|listings?|outreach)\b[^;]{0,60}?\bonly\s+(?:in|to)\b[^;]{0,60}?\b(?:not|never|excluding|except)\b/i,
  },
  {
    protectedClass: 'military or veteran status',
    legalBasis: IHRA,
    pattern: /\b(military|veterans?|active[-\s]duty|discharge\s+status)\b/i,
  },
  {
    protectedClass: 'arrest record or order of protection status',
    legalBasis: IHRA,
    pattern:
      /\b(arrest\s+records?|orders?\s+of\s+protection|domestic\s+violence\s+(?:victims?|survivors?))\b/i,
  },
];

/** Any protected-class term, from every rule's lexicon. */
const CLASS_TERM = PROTECTED_CLASS_RULES.map((r) => r.pattern.source.replace(/^\\b/, '').replace(/\\b$/, '')).join('|');

const ACTION_RULES: ReadonlyArray<{ readonly action: FairHousingAction; readonly pattern: RegExp }> = [
  {
    action: 'exclusion',
    pattern:
      /\b(exclud\w*|except(?:ing)?|but\s+not|leave\s+out|skip\w*|pass\s+on|never\s+hear|need\s+not\s+apply|not\s+(?:accepted|welcome|allowed)|unsuitable\s+for|must\s+(?:speak|be)|wanted|discourag\w*|prevent\w*|filter\s+out|block\w*|ban\w*|restrict\w*|reject\w*|deny|deni\w*|refus\w*|turn\s+away|screen\s+out|keep\s+(?:out|away)|keep\s+.*\bfrom\b|avoid\w*|hide\w*|don'?t\s+(?:show|rent|lease|let|allow|want|accept)|do\s+not\s+(?:show|rent|lease|let|allow|want|accept|see)|not\s+(?:show|shown|see|reach|rent|lease|allow|accept)|won'?t\s+see|no\s+(?:kids|children|families|pets\s+or\s+kids|vouchers?|section[-\s]?8)|no\s+(?:wheelchairs?|strollers?)|without\s+(?:kids|children|families|vouchers?|wheelchairs?|service\s+animals?)|away\s+from)\b/i,
  },
  {
    action: 'exclusion',
    pattern: /\b\w+(?:[-\s]\w+)?\s+only\b|\bonly\s+\w+/i,
  },
  {
    // "No <class>" names a group to exclude, whatever the group is.
    action: 'exclusion',
    pattern: new RegExp(`\\b(?:no|none\\s+of\\s+the|zero|nobody\\s+who\\s+is)\\s+(?:[\\w-]+\\s+){0,2}?(?:${CLASS_TERM})\\b`, 'i'),
  },
  {
    // Denial by misstatement: telling someone a unit is gone, or marking it
    // unavailable for someone, when it is not.
    action: 'exclusion',
    pattern:
      /\b(?:tell|inform|say|claim|pretend|answer)\w*\b.*\b(?:full|unavailable|taken|rented|leased|booked|sold\s+out|no\s+vacanc\w*|no\s+(?:units?|apartments?|openings?|availability|space|room)|none\s+(?:left|available|open)|(?:are|is)\s+none|not\s+available|wait[-\s]?list\w*|waiting\s+list|nothing\s+(?:(?:is|was)\s+)?(?:left|available|open))\b|\b(?:unavailable|full|taken|not\s+available|closed|wait[-\s]?list(?:ed)?|waiting\s+list)\s+(?:for|to)\b/i,
  },
  {
    // Differential treatment: different terms, delay, sabotage or extra
    // conditions for a group, without any word of exclusion.
    action: 'differential',
    pattern:
      /\b(charg\w*|quot\w*|higher|lower|extra|surcharg\w*|deposits?|co-?signers?|guarantors?|delay\w*|slow\w*|los[et]\w*|misplac\w*|ignor\w*|pay\w*|turn\w*\s+down|told|tell\w*|treat\w*|requir\w*|need\w*|must|should|ought|make\s+(?:them|\w+\s+\w+)|callbacks?|call\w*\s+back|last\s+in\s+line|back\s+of\s+the\s+line|waitlist\w*|stricter|more\s+(?:documents?|paperwork|checks?|screening))\b/i,
  },
  {
    action: 'targeting',
    pattern:
      /\b(target\w*|ad\s+audiences?|audience\s+for|show\s+(?:the\s+)?ads?\s+to|only\s+show|market\s+(?:it\s+|this\s+)?to|advertis\w*\s+to|aim\w*\s+at|reach\s+only|geofenc\w*|lookalike)\b/i,
  },
  {
    action: 'steering',
    pattern:
      /\b(steer\w*|best\s+(?:building|property|place|fit|unit)s?\s+for|(?:building|property|unit)s?\s+(?:best\s+)?suited\s+for|suited\s+for|ideal\s+for|right\s+(?:building|fit)\s+for|recommend\s+(?:a\s+|the\s+)?(?:building|property)\s+for|where\s+should\s+(?:a|an|the)?\s*\w+.*\b(?:live|go)|which\s+(?:building|property)\s+(?:do|would|should|will)\s+.*\b(?:prefer|like|fit|suit)|put\s+(?:them|those|these)\s+in|demographic\s+fit|rank\w*\s+.*\b(?:fewest|most|least)|fewest|whitest|elsewhere|somewhere\s+else|other\s+buildings?|toward\s+the\s+other|nudg\w*|keep\s+it\s+that\s+way)\b/i,
  },
  {
    // Steering by withholding: stop, avoid or never showing, marketing,
    // offering or leasing to a group; keeping a group out of a building;
    // showing a building only to a group; moving a group elsewhere.
    action: 'steering',
    pattern:
      /\b((?:stop|stopped|quit|cease|halt|avoid|end)\s+(?:show|market|advertis|offer|rent|leas|tour|promot|send)\w*|(?:don'?t|do\s+not|never|shouldn'?t|should\s+not|not)\s+(?:be\s+)?(?:show|shown|market|advertis|offer|rent|leas|tour|promot|send)\w*|keep\s+(?:\w+[-\s]+){0,5}?(?:out|away)\b|show\w*\s+(?:\w+\s+){0,4}?only\s+(?:to|for)|(?:move|put|place|relocat\w*|send|assign)\s+(?:\w+[-\s]+){0,6}?(?:to|in|into)\s+(?:\w+\s+){0,4}?(?:instead\s+of|rather\s+than|not\s+(?:in|at|to)\b|away\s+from))/i,
  },
  {
    action: 'preference',
    pattern:
      /\b(prefer\w*|prioritiz\w*|favou?r\w*|ideal\s+(?:tenant|resident|renter|applicant)s?|perfect\s+for|great\s+for\s+(?:young|single|married|christian|families)|looking\s+for\s+(?:young|mature|christian|single|married)|write\s+(?:a\s+|an\s+)?(?:listing|ad|post)\b.*\b(?:for|to|that)\b)\b/i,
  },
];

/** Inclusive or descriptive wording that is lawful even when a class is named. */
const INCLUSIVE_RE =
  /\b(welcom\w*|everyone|all\s+(?:are|applicants|renters|residents|families)\s+welcome|regardless\s+of|inclusive|equal\s+housing\s+opportunity|accessib\w*|reasonable\s+accommodations?|accept(?:s|ing)?\s+(?:all|housing\s+choice\s+vouchers|section[-\s]?8|vouchers))\b/i;

/** Wording that turns inclusive phrasing back into a restriction. */
const RESTRICTION_OVERRIDE_RE =
  /\b(only|but\s+not|except|excluding|no\s+(?:kids|children)|don'?t|do\s+not|not\s+(?:show|rent|allow))\b/i;

export interface FairHousingClassification {
  readonly refused: boolean;
  readonly actions: readonly FairHousingAction[];
  readonly classes: readonly ProtectedClassRule[];
  readonly inclusive: boolean;
}

const CONFUSABLES: Readonly<Record<string, string>> = {
  а: 'a', е: 'e', і: 'i', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ѕ: 's', ј: 'j', м: 'm', к: 'k', н: 'h', т: 't', в: 'b',
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's',
};

/**
 * One canonical spelling before any rule runs: compatibility forms (full-width),
 * no zero-width or format characters, no diacritics, Cyrillic look-alikes and
 * leetspeak folded inside words, s-p-e-l-l-e-d words joined, base64 decoded,
 * lower case, single spaces.
 */
const HTML_NAMED: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  shy: '', zwj: '', zwnj: '', lrm: '', rlm: '', hyphen: '-', dash: '-', ndash: '-', mdash: '-', minus: '-',
  lowbar: '_', period: '.', middot: '.', szlig: 'ss', aelig: 'ae', oelig: 'oe', eth: 'd', thorn: 'th',
};
/** Accented-letter entities name their base letter: &iacute; is i, &Ntilde; is N. */
const HTML_ACCENT_RE = /&([a-z])(?:acute|grave|circ|uml|tilde|ring|cedil|caron|slash|macr|breve|ogon|dot|dblac|strok);/gi;

function decodeOnce(text: string): string {
  return text
    .replace(/\\u\{?([0-9a-f]{4,6})\}?/gi, (m, h) => { const c = parseInt(h, 16); return c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&#x([0-9a-f]{1,6});?/gi, (m, h) => { const c = parseInt(h, 16); return c <= 0x10ffff ? String.fromCodePoint(c) : m; })
    .replace(/&#(\d{1,7});?/g, (m, d) => (Number(d) <= 0x10ffff ? String.fromCodePoint(Number(d)) : m))
    .replace(HTML_ACCENT_RE, (_, l) => l)
    .replace(/&([a-z]+);/gi, (m, n) => HTML_NAMED[n.toLowerCase()] ?? m)
    .replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
      try { return decodeURIComponent(m); } catch { return m.replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); }
    });
}

/** Undo transport encodings until nothing changes, so %2569 and &amp;iacute; decode too. */
function decodeTransport(text: string): string {
  let current = text;
  for (let i = 0; i < 8; i++) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

export function normalizeForFairHousing(text: string): string {
  const plain = decodeTransport(text);
  const decoded = (plain.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? [])
    .filter((t) => t.length >= 16 || (t.replace(/=+$/, '').length % 4 === 0 && /[A-Z]/.test(t) && /[a-z0-9]/.test(t.slice(1))))
    .map((t) => Buffer.from(t, 'base64').toString('latin1'))
    .filter((t) => /^[\x20-\x7e]+$/.test(t));
  // Case-fold before stripping marks so dotless ı plus a combining dot
  // folds to i; then a de-hyphenated copy catches fami-lies.
  const folded = [plain, ...decoded]
    .join(' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}\u00ad\u200b-\u200f\u2060-\u2064\ufeff]/gu, '')
    .normalize('NFKC')
    // Every dash is one hyphen and every separator one space.
    .replace(/[\p{Pd}\u2010-\u2015\u2212\u2043\ufe63\uff0d]/gu, '-')
    .replace(/[\p{Z}\t]/gu, ' ');
  // A joined copy catches fami-lies, fami_lies and fami.lies.
  const unhyphenated = folded.replace(/(?<=[\p{L}'’])[-_.·]+(?=[\p{L}'’])/gu, '');
  return (unhyphenated === folded ? folded : `${folded} . ${unhyphenated}`)
    .replace(/(?<=\p{L})[аеіорсухѕјмкнтв013457@$](?=\p{L})|[аеіорсухѕјмкнтв](?=\p{L})|(?<=\p{L})[аеіорсухѕјмкнтв]/gu, (c) => CONFUSABLES[c] ?? c)
    // A token of letters and leet digits only (k33p, 0ut, l1ttl3) is a word.
    .replace(/(?<![\p{L}\d])[\p{L}013457@$]*\p{L}[\p{L}013457@$]*(?![\p{L}\d])/gu, (w) => (/[013457@$]/.test(w) ? w.replace(/[013457@$]/g, (c) => CONFUSABLES[c]) : w))
    .replace(/(?<![\p{L}\d])[013457@$]+(?=\p{L})|(?<=\p{L})[013457@$]+(?![\p{L}\d])/gu, (d) => d.replace(/./g, (c) => CONFUSABLES[c] ?? c))
    .replace(/\b(?:[a-z][-.*_ ]){2,}[a-z]\b/g, (m) => m.replace(/[-.*_ ]/g, ''))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inclusive wording clears only its own clause, never the whole request. */
const CLAUSE_SPLIT_RE = /[.;!?\n,]|\b(?:but|though|although|however|yet)\b/;

/**
 * Spanish, French and German words for the groups and the exclusions the
 * rules know, mapped onto the English lexicon (F-044). Matched after
 * normalisation, so accents are already gone.
 */
const TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:sin|pas\s+d(?:e\b|')|sans|keine?n?|ningun[oa]s?|aucun\w*)\b/g, 'no '],
  [/\b(?:solo|solamente|seulement|uniquement|nur)\b/g, 'only'],
  [/\b(?:rechaz\w*|refus\w*|ablehn\w*|abweis\w*|exclu\w*|ausschlie\w*)\b/g, 'reject'],
  [/\b(?:ninos|ninas|enfants?|kinder[n]?|bebes?)\b/g, 'kids'],
  [/\b(?:familias?|familles?|familien)\b/g, 'families'],
  [/\b(?:auslander\w*|extranjer\w*|etrangers?|inmigrantes?|immigres?|einwanderer\w*)\b/g, 'foreigners'],
  [/\b(?:musulman\w*|muslime\w*)\b/g, 'muslims'],
  [/\b(?:judios?|juifs?|juden)\b/g, 'jews'],
  [/\b(?:negros?|noirs?|schwarze\w*)\b/g, 'blacks'],
  [/\b(?:mujeres|femmes|frauen)\b/g, 'women'],
  [/\b(?:discapacitad\w*|handicape\w*|behindert\w*)\b/g, 'disabled'],
  [/\b(?:hijos?|hijas?)\b/g, 'kids'],
  [/\b(?:inquilin\w*|arrendatari\w*|locataires?|mieter\w*)\b/g, 'tenants'],
  [/\b(?:deutsche\w*|alemanes|allemands)\b/g, 'germans'],
  [/\b(?:no\s+(?:queremos|rentar|alquilar)|evita\w*|ne\s+louez\s+pas|nicht\s+vermiet\w*)\b/g, 'do not rent'],
];

/**
 * Chinese and Russian, read before Cyrillic look-alikes are folded to Latin
 * (which would turn Не сдавать into he cdabatь).
 */
const RAW_TRANSLATIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/不要|不租|别租|不准|不许|拒绝|не\s+сда\w*|не\s+пуска\w*|отказ\w*|только|只/g, ' do not rent '],
  [/孩子|儿童|小孩|дет\w*|ребен\w*/g, ' kids '],
  [/家庭|семь\w*/g, ' families '],
  [/穆斯林|мусульман\w*/g, ' muslims '],
  [/移民|мигрант\w*|иностран\w*/g, ' immigrants '],
  [/租给|арендатор\w*|жильц\w*/g, ' tenants '],
];

function translate(text: string, raw: string): string {
  const out = TRANSLATIONS.reduce((t, [re, en]) => t.replace(re, en), text);
  const lowered = raw.normalize('NFKC').toLowerCase();
  const rawOut = RAW_TRANSLATIONS.reduce((t, [re, en]) => t.replace(re, en), lowered);
  return [text, ...(out === text ? [] : [out]), ...(rawOut === lowered ? [] : [rawOut.replace(/[^\x20-\x7e]+/g, ' ')])].join(' . ');
}

/**
 * The closed grammar of L2. A sentence is refused when it refers to people
 * and directs a treatment or decision at them, unless the criterion it uses
 * is one of a closed list of lawful ones. The group need not be in any
 * lexicon: "keep brown folks out" refers to people (folks) and directs an
 * exclusion, and nothing lawful explains it, so it is refused.
 */
const PERSON_REF_RE =
  /\b(?:people|persons?|folks?|applicants?|tenants?|renters?|residents?|prospects?|households?|famil(?:y|ies)|ones|users?|speakers?|holders?|recipients?|couples?|women|men|woman|man|kids|children|guys|ladies|callers?|customers?|occupants?|lessees?|neighbou?rs?|individuals?|anyone|anybody|everyone|someone|those|them|they|their|whoever|types?|crowd|kind\s+of\s+(?:tenants?|renters?|people)|germans|muslims|immigrants|foreigners|blacks|jews)\b/i;
const TREATMENT_RE =
  /\b(?:steer\w*|discriminat\w*|pretend\w*|(?:quote|charge)\w*\s+(?:\S+\s+){0,3}?\$?\d+\s+(?:more|extra|higher)|first\s+in\s+(?:the\s+)?(?:queue|line)|rais\w*\s+(?:the\s+|their\s+)?(?:quotes?|rents?|prices?|deposits?)\s+(?:for|on)|end\s+up\s+in|(?:should|must|will|do)?\s*not\s+reach|requir\w*\s+(?:\S+\s+){0,5}?to\s+(?:have|pay|provide|bring|show|get)|(?:add|charge|impose|apply)\w*\s+(?:\S+\s+){0,3}?(?:fees?|surcharges?|deposits?|premiums?)\s+(?:for|on|to)|(?:route|send|assign|transfer|refer|hand)\w*\s+(?:\S+\s+){0,6}?to\s+(?:a\s+|the\s+)?(?:different|another|separate|other|special)|talk\s+\w+\s+out\s+of|(?:let|tell|inform|say\s+to)\s+(?:\S+\s+){0,5}?(?:know|that)\b[^.?!]*\b(?:full|taken|unavailable|gone|booked|none\s+left|no\s+openings)|keep\s+(?:\w+[-\s]+){0,4}?(?:out|away|off)|\w+\s+than\s+(?:everyone|everybody|anyone|anybody|others|the\s+rest|other\s+\w+)|wait\s+(?:for|on|longer)|leave\s+(?:\w+\s+){0,4}?out|skip\w*|exclud\w*|discourag\w*|prioriti[sz]\w*|deprioriti[sz]\w*|prefer\w*|favou?r\w*|rank\w*|reject\w*|deny|deni\w*|refus\w*|turn\s+(?:\w+\s+)?(?:away|down)|screen\s+out|filter\s+out|block\w*|ban\w*|avoid\w*|bar\b|barred|waitlist\w*|wait[-\s]list\w*|hold\s+(?:\w+\s+){0,4}?for|reserve\w*\s+(?:\w+\s+){0,4}?for|set\s+aside|offer\s+(?:\w+\s+){0,4}?(?:to|instead)|(?:do\s+not|don'?t|never|not)\s+(?:\w+\s+)?(?:want|rent|lease|show|offer|accept|allow|let|tour|call|hear)|only\s+(?:show|rent|lease|offer|accept|allow|give|market|advertis\w*)|(?:show|market|advertis\w*|target\w*)\s+(?:\w+\s+){0,4}?only|bottom\s+of|top\s+of\s+the\s+list|at\s+the\s+(?:bottom|back|end)|elsewhere|somewhere\s+else|instead|no\s+(?:\w+\s+)?(?:tenants|renters|applicants|people|folks)|only\s+(?:\w+\s+){0,2}?(?:tenants|renters|applicants|people|folks)|never\s+hear|worst|worse|longer\s+(?:\w+\s+)?form|extra\s+(?:\w+\s+)?(?:references|documents|checks|deposits?|fees?)|not\s+qualified|charg\w*\s+more|bump\s+the|good\s+fit|not\s+a\s+fit|liabilit\w*)\b/i;
/** Lawful criteria: the facts a landlord may act on, stated about the people. */
const LAWFUL_CRITERION_RE =
  /\b(?:credit\s+(?:checks?|scores?|history|reports?)|(?:standard|the\s+same)\s+screening|(?:complete|completed|missing)\s+(?:paperwork|documents?|id|applications?)|corporate\s+leases?|business\s+leases?|leases?\s+(?:end\w*|expir\w*|start\w*|up)|lease\s+end|renewal\w*|renew\w*|(?:on\s+)?notice|move[-\s]?(?:in|out)|late\s+(?:rent|fees?|payments?)|past[-\s]due|unpaid|balance\s+owed|owe\w*|applications?\s+(?:is\s+)?(?:complete\w*|incomplete|fees?|submitted|first)|(?:completed|submitted|finished)\s+(?:their|an?|the)\s+application|incomplete\s+applications?|(?:already\s+)?signed(?:\s+(?:a|the))?(?:\s+lease)?|unit\s+is\s+ready|until\s+(?:the\s+)?(?:unit|apartment)|pa(?:y|id|ys)\s+on\s+time|payment\s+history|double[-\s]?book\w*|schedul\w*|(?:no[-\s])?show(?:ed)?\s+(?:up|for\s+(?:the|their)\s+tour)|missed\s+(?:the|their)\s+tours?|pets?|dogs?\s+over|smok\w*|parking|lead\s+source|from\s+(?:zillow|apartments\.com|google|facebook|the\s+website|the\s+portal|craigslist|referrals?)|everyone|all\s+applicants|regardless\s+of)\b/i;

const COMPARED_WITH_REST_RE = /\bthan\s+(?:everyone|everybody|anyone|anybody|others|the\s+rest|other\s+\w+)(?:\s+else)?/g;

/** A person noun, or a protected-class term, which names people itself. */
const refersToPeople = (s: string) => PERSON_REF_RE.test(s) || PROTECTED_CLASS_RULES.some((r) => r.pattern.test(s));

function personDirected(text: string): boolean {
  // "than everyone else" compares a group with the rest; it is not the
  // lawful "everyone" of a rule applied to all.
  return (text.match(/[^.?!;\n]+[.?!;\n]?/g) ?? []).some((s) => refersToPeople(s) && TREATMENT_RE.test(s) && !LAWFUL_CRITERION_RE.test(s.replace(COMPARED_WITH_REST_RE, ' ')));
}

/** A statement that describes the building or the task, not people. */
const DESCRIPTIVE_RE =
  /\b(?:(?:building|property|it|unit)\s+(?:has|have|includes?|features?|offers?)\b|(?:tenants?|residents?|renters?)\s+(?:include|includes)\b|translat\w*|near(?:by)?\b|close\s+to|next\s+to\s+the\s+\w+\s+(?:church|temple|mosque|synagogue|school)|requested\s+(?:a|an)\s+(?:ramp|accommodation|modification|grab\s+bar|transfer|accessible)|reasonable\s+accommodation)/i;

// English function words: a sentence of three or more words with none of
// them is in a language the grammar does not read.
const ENGLISH_FUNCTION_WORDS = new Set(
  'a an the is are was were be been am do does did to of in on at for from by with and or but not no nor if so as than that this these those it its we our us you your they them their he she his her i me my all any each every some only please thanks thank can could will would should may must have has had within without after before until between per via now then too very more less same other what which who how when where why there here up out off over under into about also just'.split(' '),
);

/**
 * A statement (not a question) carrying letters outside the Latin script, or
 * three or more words with no English function word, is an instruction the
 * closed grammar cannot read. Questions are left to L1, which answers unknown.
 */
function unreadableInstruction(raw: string): boolean {
  const text = decodeTransport(raw).normalize('NFKC').replace(/[\p{Cf}\u200b-\u200f\u2060-\u2064\ufeff]/gu, '');
  return (text.match(/[^.?!;\n。！？；]+[.?!;\n。！？；]?/gu) ?? []).some((x) => {
    if (/[?？]\s*$/.test(x)) return false;
    if (/(?![\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])\p{L}/u.test(x) && !/^[\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]*$/u.test(x)) return true;
    if (/[\p{Script=Cyrillic}\p{Script=Greek}]{2,}/u.test(x) && !/[\p{Script=Latin}]{2,}/u.test(x.replace(/[\p{Script=Cyrillic}\p{Script=Greek}]+/gu, ''))) return true;
    const words = x.toLowerCase().match(/\p{L}+/gu) ?? [];
    // Short English fragments ("Percent, one decimal.") lack function
    // words too, so three words need a non-ASCII letter and four suffice.
    const long = words.length >= 4 || (words.length >= 3 && /[^\x00-\x7f]/.test(words.join('')));
    return long && !words.some((w) => ENGLISH_FUNCTION_WORDS.has(w) || FIXED.has(w));
  });
}

/** Each word spelled backwards, so "milsuM" names its group too. */
const reversedWords = (text: string) => text.split(' ').map((w) => [...w].reverse().join('')).join(' ');

export function classifyFairHousingRequest(rawQuestion: string): FairHousingClassification {
  const text = translate(normalizeForFairHousing(rawQuestion), rawQuestion).replace(COMPARED_WITH_REST_RE, ' than others');
  const restricted = RESTRICTION_OVERRIDE_RE.test(text);
  const clauses = text.split(CLAUSE_SPLIT_RE).filter((c) => c.trim());
  const isInclusive = (c: string) => !restricted && INCLUSIVE_RE.test(c);
  const inclusive = clauses.some(isInclusive);
  // Drop inclusive clauses but keep each sentence's other clauses together,
  // so "If the caller sounds X, quote $200 more" stays one decision.
  const question = (text.match(/[^.?!;\n]+[.?!;\n]?/g) ?? [])
    .map((sen) => sen.split(CLAUSE_SPLIT_RE).filter((c) => c.trim() && !isInclusive(c)).join(' , '))
    .filter((sen) => sen.trim())
    .join(' . ');
  const classes = PROTECTED_CLASS_RULES.filter((r) => r.pattern.test(question) || r.pattern.test(reversedWords(question)));
  const actions: FairHousingAction[] = [
    ...new Set(ACTION_RULES.filter((r) => r.pattern.test(question)).map((r) => r.action)),
  ];
  // A class and an action count only when they share a sentence: naming a
  // group ("Jewish holidays", "speaks Spanish") is not a decision about it.
  const sentences = (question.match(/[^.?!;\n]+[.?!;\n]?/g) ?? []).filter((x) => x.trim());
  const refusedByClass = sentences.some((x) => {
    const named = PROTECTED_CLASS_RULES.some((r) => r.pattern.test(x) || r.pattern.test(reversedWords(x)));
    const acts = ACTION_RULES.filter((r) => r.pattern.test(x)).map((r) => r.action);
    return named && acts.length > 0 && !(DESCRIPTIVE_RE.test(x) && !acts.some((a) => a !== 'differential'));
  });
  const directed = personDirected(question);
  // Deny by default, whatever the script: an instruction FlowIQ cannot read
  // cannot be shown to be lawful.
  const unreadable = unreadableInstruction(rawQuestion);
  if ((directed || unreadable) && !actions.includes('differential')) actions.push('differential');
  return {
    refused: refusedByClass || directed || unreadable,
    actions,
    classes,
    inclusive,
  };
}

/**
 * A session remembers that it refused a request. A later turn that points
 * back at people ("them", "the people I mentioned") is refused too, so a
 * refused request cannot be split across turns.
 */
export interface FairHousingSession {
  refusedEarlier: boolean;
}

/**
 * A turn that carries on from the last one rather than asking afresh:
 * "Same for Fulton Yards.", "Continue.", "Repeat for P03.", "Apply the
 * earlier instruction.". After a refusal such a turn inherits the refused
 * instruction, so it is refused too.
 */
const CONTINUATION_RE =
  /^(?:same|now|and|also|again|repeat|redo|continue|proceed|next|then|ditto|do\s+(?:it|that|the\s+same|.*\bnext))\b|\b(?:same\s+(?:rule|policy|instruction|thing|approach|as\s+before)|as\s+before|(?:earlier|previous|last|prior|above)\s+(?:instruction|rule|request|policy)|continue|carry\s+on|keep\s+going|like\s+before)\b/i;

export function continuesPreviousTurn(question: string): boolean {
  return (normalizeForFairHousing(question).match(/[^.?!;]+/g) ?? []).some((s) => CONTINUATION_RE.test(s.trim()));
}


const ANAPHOR_RE =
  /\b(?:them|they|their|(?:those|these|such|the\s+same)\s+(?:people|persons|folks|famil(?:y|ies)|tenants|renters|applicants|prospects|households|ones|groups?|kinds?|types?|crowd)|(?:the|those)\s+(?:people|folks|ones|group|famil(?:y|ies)|applicants|tenants)\s+(?:i|we|you)\s+(?:mentioned|said|described|named|meant|talked\s+about)|(?:that|this)\s+(?:group|crowd|kind|type)|(?:the\s+)?(?:people|folks|group)\s+(?:above|from\s+before|earlier))\b/i;

export function refersBackToPeople(question: string): boolean {
  return ANAPHOR_RE.test(normalizeForFairHousing(question));
}
