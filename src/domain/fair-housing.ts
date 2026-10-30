/**
 * Fair Housing request classifier (FLOW-103).
 *
 * A request is refused when it combines a discriminatory ACTION with a
 * PROTECTED CLASS or a close proxy for one. Neither alone is enough:
 * "how many three-bedroom units are vacant? we get family inquiries"
 * names a family but asks for nothing discriminatory, and "exclude void
 * invoices" is an exclusion with no protected class. Inclusive wording
 * ("welcomes families with children") is allowed.
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
      /\b(famil(?:y|ies)|children|child|kids?|minors|toddlers?|babies|baby|teen(?:ager)?s?|pregnan\w*|expecting\s+mothers?|strollers?|school[-\s]?age|parents?|adults?[-\s]only|no[-\s]kids|child[-\s]?free|empty[-\s]?nesters?|dinks?)\b/i,
  },
  {
    protectedClass: 'race or color',
    legalBasis: FHA,
    pattern:
      /\b(race|racial\w*|color(?:ed)?\s+(?:people|tenants|renters|residents|applicants)|people\s+of\s+color|black|white|asian|hispanic|latin[oax]s?|african[-\s]american|caucasian|ethnic\w*|minorit(?:y|ies)|demographic\s+fit|right\s+demographic)\b/i,
  },
  {
    protectedClass: 'national origin, ancestry, or language',
    legalBasis: `${FHA} and ${IHRA}`,
    pattern:
      /\b(national\s+origin|ancestry|immigrants?|foreign(?:ers)?|citizens?(?:hip)?|non[-\s]?citizens?|undocumented|green\s+card|accents?|english[-\s]speak\w*|native\s+english|speaks?\s+(?:good\s+|fluent\s+)?english|spanish[-\s]speak\w*|non[-\s]english|esl|mexican\w*|indian|chinese|polish|arab\w*|middle\s+eastern)\b/i,
  },
  {
    protectedClass: 'religion',
    legalBasis: FHA,
    pattern:
      /\b(religio(?:n|us)|church[-\s]?go\w*|churchgo\w*|church|christians?|catholics?|protestants?|muslims?|islamic|jewish|jews?|hindus?|sikhs?|buddhists?|atheists?|synagogue|mosque|temple[-\s]go\w*|faith[-\s]based|devout)\b/i,
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
      /\b(disab(?:ility|ilities|led)|handicap\w*|wheelchairs?|service\s+(?:animals?|dogs?)|emotional\s+support\s+animals?|esas?|blind|deaf|mental(?:ly)?\s+ill\w*|mental\s+health|hiv|aids\s+patients?|recovering\s+addicts?)\b/i,
  },
  {
    protectedClass: 'age',
    legalBasis: `${IHRA} and ${CHICAGO}`,
    pattern:
      /\b(over\s+\d{2}|under\s+\d{2}|older\s+than\s+\d{2}|younger\s+than\s+\d{2}|age[sd]?\s+\d{2}|seniors?|elderly|older\s+(?:people|tenants|renters|residents|applicants|adults)|retirees?|young(?:er)?\s+(?:people|tenants|renters|residents|applicants|professionals|adults|crowd)|millennials?|gen[-\s]?z|boomers?)\b/i,
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
      /\b(section[-\s]?8|housing\s+choice\s+vouchers?|vouchers?|voucher\s+holders?|hcv|public\s+assistance|welfare|ssi|ssdi|disability\s+income|source\s+of\s+income)\b/i,
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

const ACTION_RULES: ReadonlyArray<{ readonly action: FairHousingAction; readonly pattern: RegExp }> = [
  {
    action: 'exclusion',
    pattern:
      /\b(exclud\w*|discourag\w*|prevent\w*|filter\s+out|block\w*|ban\w*|restrict\w*|reject\w*|deny|deni\w*|refus\w*|turn\s+away|screen\s+out|keep\s+(?:out|away)|keep\s+.*\bfrom\b|avoid\w*|hide\w*|don'?t\s+(?:show|rent|lease|let|allow|want|accept)|do\s+not\s+(?:show|rent|lease|let|allow|want|accept|see)|not\s+(?:show|shown|see|reach|rent|lease|allow|accept)|won'?t\s+see|no\s+(?:kids|children|families|pets\s+or\s+kids|vouchers?|section[-\s]?8)|without\s+(?:kids|children|families|vouchers?|wheelchairs?|service\s+animals?)|away\s+from)\b/i,
  },
  {
    action: 'exclusion',
    pattern: /\b\w+(?:[-\s]\w+)?\s+only\b|\bonly\s+(?:rent|lease|show|market|advertise|accept|allow|want)\b/i,
  },
  {
    action: 'targeting',
    pattern:
      /\b(target\w*|ad\s+audiences?|audience\s+for|show\s+(?:the\s+)?ads?\s+to|only\s+show|market\s+(?:it\s+|this\s+)?to|advertis\w*\s+to|aim\w*\s+at|reach\s+only|geofenc\w*|lookalike)\b/i,
  },
  {
    action: 'steering',
    pattern:
      /\b(steer\w*|best\s+(?:building|property|place|fit|unit)s?\s+for|(?:building|property|unit)s?\s+(?:best\s+)?suited\s+for|suited\s+for|ideal\s+for|right\s+(?:building|fit)\s+for|recommend\s+(?:a\s+|the\s+)?(?:building|property)\s+for|where\s+should\s+(?:a|an|the)?\s*\w+.*\b(?:live|go)|which\s+(?:building|property)\s+(?:do|would|should|will)\s+.*\b(?:prefer|like|fit|suit)|put\s+(?:them|those|these)\s+in|demographic\s+fit|rank\w*\s+.*\b(?:fewest|most|least))\b/i,
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

export function classifyFairHousingRequest(question: string): FairHousingClassification {
  const classes = PROTECTED_CLASS_RULES.filter((r) => r.pattern.test(question));
  const actions = [
    ...new Set(ACTION_RULES.filter((r) => r.pattern.test(question)).map((r) => r.action)),
  ];
  const inclusive =
    INCLUSIVE_RE.test(question) && !RESTRICTION_OVERRIDE_RE.test(question);
  return {
    refused: classes.length > 0 && actions.length > 0 && !inclusive,
    actions,
    classes,
    inclusive,
  };
}
