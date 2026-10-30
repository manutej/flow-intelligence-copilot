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

export type FairHousingAction = 'targeting' | 'exclusion' | 'steering' | 'preference';

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
      /\b(race|racial\w*|color(?:ed)?\s+(?:people|tenants|renters|residents|applicants)|people\s+of\s+color|blacks?|whit(?:es?|er|est)|asian|hispanic|latin[oax]s?|african[-\s]american|caucasian|native\s+americans?|indigenous|pacific\s+islanders?|biracial|mixed[-\s]race|ethnic\w*|minorit(?:y|ies)|demographics?)\b/i,
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
      /\b(over\s+\d{2}|under\s+\d{2}|(?:older|younger)\s+than\s+[\w-]+|born\s+(?:before|after|in)\s+\d{4}|mature\s+(?:people|tenants|renters|residents|applicants)|age[sd]?\s+\d{2}|seniors?|elderly|older\s+(?:people|tenants|renters|residents|applicants|adults)|retirees?|young(?:er)?\s+(?:people|tenants|renters|residents|applicants|professionals|adults|crowd)|millennials?|gen[-\s]?z|boomers?)\b/i,
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
  а: 'a', е: 'e', і: 'i', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', ѕ: 's', ј: 'j',
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
  const decoded = (plain.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? [])
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
    .replace(/(?<=\p{L})[аеіорсухѕј013457@$](?=\p{L})|[аеіорсухѕј](?=\p{L})|(?<=\p{L})[аеіорсухѕј]/gu, (c) => CONFUSABLES[c] ?? c)
    .replace(/\b(?:[a-z][-.*_ ]){2,}[a-z]\b/g, (m) => m.replace(/[-.*_ ]/g, ''))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Inclusive wording clears only its own clause, never the whole request. */
const CLAUSE_SPLIT_RE = /[.;!?\n,]|\b(?:but|though|although|however|yet)\b/;

export function classifyFairHousingRequest(rawQuestion: string): FairHousingClassification {
  const text = normalizeForFairHousing(rawQuestion);
  const restricted = RESTRICTION_OVERRIDE_RE.test(text);
  const clauses = text.split(CLAUSE_SPLIT_RE).filter((c) => c.trim());
  const isInclusive = (c: string) => !restricted && INCLUSIVE_RE.test(c);
  const inclusive = clauses.some(isInclusive);
  const question = clauses.filter((c) => !isInclusive(c)).join(' . ');
  const classes = PROTECTED_CLASS_RULES.filter((r) => r.pattern.test(question));
  const actions = [
    ...new Set(ACTION_RULES.filter((r) => r.pattern.test(question)).map((r) => r.action)),
  ];
  return {
    refused: classes.length > 0 && actions.length > 0,
    actions,
    classes,
    inclusive,
  };
}
