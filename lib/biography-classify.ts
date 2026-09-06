// Biography facts arrive as one undifferentiated list. Grouping them is what
// turns a wall of quotes into a profile, and it is what lets the assistant
// answer "where did they go to school" without rescanning every fact.
//
// Rules run first and carry the load: these are short, formulaic sentences
// from official biographies, and a keyword pass is deterministic, free, and
// re-runnable. Only genuinely ambiguous text is worth a model call, and a fact
// that matches nothing stays uncategorized rather than being forced into a
// bucket it does not belong in.

export const BIOGRAPHY_FACT_TYPES = [
  "military",
  "education",
  "public_service",
  "career",
  "family",
  "origin",
  "community",
  "honors",
] as const;

export type BiographyFactType = (typeof BIOGRAPHY_FACT_TYPES)[number];

export const FACT_TYPE_LABEL: Record<BiographyFactType, string> = {
  military: "Military service",
  education: "Education",
  public_service: "Public service",
  career: "Career",
  family: "Family",
  origin: "Roots",
  community: "Community",
  honors: "Honors",
};

// Display order on a profile: who they are, then what they have done.
export const FACT_TYPE_ORDER: BiographyFactType[] = [
  "origin",
  "education",
  "military",
  "career",
  "public_service",
  "community",
  "honors",
  "family",
];

// Ordered most-specific first. "served in the Indiana State Senate" must not
// read as military, so the military patterns require an actual branch or
// veteran term rather than the bare verb "served".
const RULES: Array<{ type: BiographyFactType; pattern: RegExp }> = [
  {
    type: "military",
    pattern:
      /\b(u\.?s\.?\s+)?(navy|army|air force|marine corps|marines|coast guard|national guard|space force)\b|\b(veteran|enlisted|deploy\w*|active duty|combat tour|tour of duty|purple heart|bronze star|silver star|honorabl[ey] discharg|military service|special forces|airborne|air assault|infantry|field artillery|commissioned officer|operation (iraqi|enduring) freedom|uss [a-z]|company commander|operations officer|tactical action officer|platoon|squadron|battalion|attained the rank of|rank of (commander|captain|colonel|major|sergeant|lieutenant))/i,
  },
  {
    // An explicit career opener outranks the school named inside it: "began
    // his career as a teacher at Granite Bay High School" is a job, not a
    // degree, and the education patterns would otherwise claim it.
    type: "career",
    pattern:
      /\b(began (his|her|their) career|career as an?|worked as an?|practic(ed|ing) law|law practice|spent .{0,20}years (as|working))\b/i,
  },
  {
    type: "education",
    pattern:
      /\b(graduat\w*|degree|bachelor'?s?|master'?s?|doctorate|ph\.?d|m\.?b\.?a|j\.?d\b|law school|medical school|university|college|high school|alma mater|valedictorian|salutatorian|magna cum laude|summa cum laude|studied at)\b/i,
  },
  {
    // Holding office or a government post. Staff jobs ("director for Senator
    // X") deliberately fall through to career, because working for an
    // officeholder is not the same as being one.
    type: "public_service",
    pattern:
      /\b(state (senat\w*|represent\w*|house|assembly|legislat\w*)|city council|town council|county council|county board|mayor|commissioner|school board|attorney general|lieutenant governor|governor|sheriff|prosecutor|district attorney|justice of the peace|secretary of state|township trustee|alderman|selectman|unicameral)\b|\b(elected|re-?elected|sworn in|sworn into office|appointed to the|appointed (him|her|them)|public servant|held public office|served in congress|returned to congress|ran for congress|entered the u\.?s\.? congress|special election|congress(wo)?man|u\.?s\.? (house|senate)\b)|\brepresent(s|ed|ing)? (district|.{0,40}congressional district)|\b(serve[sd]?|sat|sits) on the .{0,60}(committee|subcommittee|board of supervisors)|\b(majority|minority) (whip|leader)\b|\bspeaker of the\b|\bchair(man|woman|person)? of the .{0,50}(committee|subcommittee)|\bdepartment of (labor|homeland security|justice|state|defense|education|agriculture|veterans affairs|health and human services|housing and urban development)\b|\b(general assembly|legislature|board of equalization|congressional delegation|deputy whip|republican conference|democratic caucus|united states senator|u\.?s\.? senator|f\.?b\.?i\.?|usda|federal (bureau|agency))\b|\bterms? in the .{0,40}(senate|house|assembly|legislature|congress)|\bunited states (house|senate)\b|\bregional administrator\b|\bstate director for\b|\b(ranking member|senate president|county (commission|judge|treasurer|executive)|state treasurer|town supervisor|white house|assistant to the president|special assistant to the president|chief medical advisor)\b|\bserving (his|her|their) (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) term|\brepresent(s|ing|ative)? (in congress |of |for )?(the )?\d+(st|nd|rd|th) (congressional )?district|\b(house|senate) district\b|\bcongressional district\b|\bu\.?s\.? representative\b|\bserves? (as|in) the\b.{0,30}\b(house|senate|congress)\b|\bchair(man|woman|person)? of the .{0,40}(commission|conference|caucus|delegation)/i,
  },
  {
    type: "career",
    pattern:
      /\b(small[- ]business\w*|business owner|businesses|entrepreneur|founded|co[- ]founded|owner of|chief executive|c\.?e\.?o\b|chief medical officer|bank president|president of|worked (as|in|at)|career as|farmer|rancher|teacher|educator|professor|nurse|physician|doctor|surgeon|practice medicine|medical director|residency|chief resident|attorney|lawyer|law firm|engineer|contractor|pilot|police officer|firefighter|pastor|journalist|economist|banker|realtor|consultant|manager|managed|employed|executive director|political director|regional director|field representative|staff(er|ed)?|intern(ed|ship)? (in|at|with)|advocate for|began (his|her|their) career|business career|career (at|with)|co[- ]owns?|owns|purchas\w+ a|consulting business|investor|venture capital|private equity|executive position\w*|board (member|of trustees|of directors)|dentist|dental office|joined \w+|litigator|practic(ed|ing) law|law practice|customs brokerage|minimum[- ]wage|broadcasting|radio and television|formed (his|her|their) own business|sales work|was a fellow at|labor union|teamsters|union\b)\b/i,
  },
  {
    type: "family",
    pattern:
      /\b(married|marri\w+ to|wife|husband|spouse|children|son|daughter|kids|grandchildren|grandson|granddaughter|father|mother|grandfather|grandmother|parent of|single parent|adult (sons|daughters)|raising (a |their )?(family|children))\b/i,
  },
  {
    type: "origin",
    pattern:
      /\b(born (and raised )?in|born and raised|born on|native\b|hometown|grew up|raised (in|on|near)|lifelong\b|originally from|has called .{0,30}home|lives in|resides in|currently lives|settled in|is a resident of|has been (his|her|their) home)\b/i,
  },
  {
    type: "community",
    pattern:
      /\b(volunteer\w*|church|congregation|rotary|kiwanis|lions club|chamber of commerce|nonprofit|non[- ]profit|charit\w+|coach\w*|little league|scout\w*|food bank|community (leader|service|organization))\b/i,
  },
  {
    type: "honors",
    pattern:
      /\b(award\w*|honored|honoree|recognized (as|for|with)|named .{0,30}of the year|hall of fame|fellowship|medal|commendation)\b/i,
  },
];

export type ClassifiedFact = {
  type: BiographyFactType | null;
  source: "rules" | "unclassified";
};

// The quote is the published text, so it is what gets classified. claimText is
// consulted only as a tiebreaker when the quote is a bare fragment.
// Official sites open sentences with the subject's title ("Congressman Al
// Green co-founded and co-managed the law firm..."). The title is how the
// site refers to the person, not what the sentence is about, so it is
// removed before the office patterns get a chance to claim the sentence.
const LEADING_HONORIFIC =
  /^(?:(?:U\.?S\.? )?(?:Congress(?:wo)?man|Senator|Representative|Rep\.|Sen\.|Dr\.|The Honorable)\s+)(?:[A-Z][A-Za-z.'-]*\s+){1,3}/;

export function stripLeadingHonorific(text: string): string {
  return text.replace(LEADING_HONORIFIC, "");
}

export function classifyBiographyFact(
  sourceQuote: string,
  claimText?: string | null
): ClassifiedFact {
  const primary = stripLeadingHonorific(sourceQuote ?? "");
  for (const rule of RULES) {
    if (rule.pattern.test(primary)) return { type: rule.type, source: "rules" };
  }
  const fallback = claimText ?? "";
  if (fallback) {
    for (const rule of RULES) {
      if (rule.pattern.test(fallback)) return { type: rule.type, source: "rules" };
    }
  }
  return { type: null, source: "unclassified" };
}
