/**
 * Split-Year Treatment — 8-case statutory framework.
 *
 * When an individual is UK-resident under the SRT but qualifies for
 * split-year treatment, only the UK part of the year is taxed as resident.
 *
 * The 8 cases are divided into:
 *   Cases 1–3: "Leaving" — individual departs the UK during the tax year
 *   Cases 4–8: "Arriving" — individual comes to the UK during the tax year
 *
 * Each case has specific qualifying conditions. Only ONE case can apply.
 * The split date determines which part of the year is the "UK part"
 * and which is the "overseas part".
 *
 * Source: HMRC Statutory Residence Test Guidance (RDRM11000 series),
 *         Finance Act 2013 Schedule 45 Part 3.
 */

export interface SplitYearInput {
  /** Which tax year (for date range determination). */
  taxYear: string;
  /** Days spent in the UK in the tax year. */
  daysInUk: number;
  /** Whether the individual was UK-resident for any of the previous 3 tax years. */
  wasResidentPrevious3Years: boolean;
  /** Whether the individual will be non-UK-resident for the following tax year. */
  willBeNonResidentNextYear?: boolean;
  /** Date the individual left the UK (YYYY-MM-DD), for leaving cases. */
  departureDate?: string;
  /** Date the individual arrived in the UK (YYYY-MM-DD), for arriving cases. */
  arrivalDate?: string;
  /** Whether the individual had a UK home. */
  hadUkHome: boolean;
  /** Whether the individual works full-time overseas after departure / before arrival. */
  worksFullTimeOverseas: boolean;
  /** Whether the individual's partner/spouse lives overseas. */
  partnerLivesOverseas?: boolean;
  /** Whether the individual starts full-time work in the UK. */
  startsFullTimeWorkInUk?: boolean;
  /** Date full-time UK work starts (YYYY-MM-DD). */
  ukWorkStartDate?: string;
  /** Number of days in UK in the overseas part (must be < 91 for some cases). */
  daysInUkDuringOverseasPart?: number;
  /** Whether the individual ceases to have a UK home. */
  ceasesUkHome?: boolean;
  /** Date the UK home ceases (YYYY-MM-DD). */
  ukHomeCeaseDate?: string;
  /** Whether the individual acquires a UK home on arrival. */
  acquiresUkHome?: boolean;
  /** Date the UK home is acquired (YYYY-MM-DD). */
  ukHomeAcquireDate?: string;
  /** Whether the individual has a home overseas. */
  hasOverseasHome?: boolean;
  /** Whether the individual's only home is overseas at the start/end of the year. */
  onlyHomeOverseas?: boolean;
}

export interface SplitYearResult {
  /** The case number (1–8), or null if split-year doesn't apply. */
  caseNumber: number | null;
  /** The split date (YYYY-MM-DD), or null. */
  splitDate: string | null;
  /** Which portion of the year is the "UK part". */
  ukPart: 'pre-split' | 'post-split' | null;
  /** Human-readable explanation. */
  reason: string;
  /** Whether split-year treatment applies at all. */
  applies: boolean;
}

/**
 * Tax year date range from a "YYYY-YY" string.
 * e.g. '2025-26' → { start: '2025-04-06', end: '2026-04-05' }
 */
function taxYearRange(taxYear: string): { start: string; end: string } {
  const startYear = parseInt(taxYear.split('-')[0], 10);
  return {
    start: `${startYear}-04-06`,
    end: `${startYear + 1}-04-05`,
  };
}

/**
 * Evaluates split-year treatment eligibility under the 8-case framework.
 *
 * The cases are tested in statutory order. The first qualifying case applies.
 */
export function evaluateSplitYear(input: SplitYearInput): SplitYearResult {
  const noSplit: SplitYearResult = {
    caseNumber: null, splitDate: null, ukPart: null,
    reason: 'Split-year treatment does not apply.', applies: false,
  };

  const { taxYear } = input;
  const range = taxYearRange(taxYear);

  // ── LEAVING CASES (1–3) ────────────────────────────────────────────────
  // These apply when an individual who was UK-resident leaves partway through.

  // Case 1: Starting to work full-time overseas
  // Conditions:
  //   (a) Was UK-resident for the previous tax year
  //   (b) Starts full-time work overseas on or after the start of the tax year
  //   (c) Has fewer than 91 days in the UK in the overseas part
  //   (d) Has no UK home from the departure date
  if (
    input.wasResidentPrevious3Years &&
    input.departureDate &&
    input.worksFullTimeOverseas &&
    !input.hadUkHome &&
    (input.daysInUkDuringOverseasPart ?? input.daysInUk) < 91
  ) {
    return {
      caseNumber: 1,
      splitDate: input.departureDate,
      ukPart: 'pre-split',
      reason: `Case 1: Starting full-time work overseas from ${input.departureDate}. UK part is before the split date.`,
      applies: true,
    };
  }

  // Case 2: Partner of someone starting to work full-time overseas
  // Conditions:
  //   (a) Was UK-resident for the previous tax year
  //   (b) Partner starts full-time work overseas
  //   (c) Individual leaves to join partner overseas
  //   (d) Has fewer than 91 days in UK in overseas part
  //   (e) Has no UK home from departure
  if (
    input.wasResidentPrevious3Years &&
    input.departureDate &&
    input.partnerLivesOverseas &&
    !input.hadUkHome &&
    (input.daysInUkDuringOverseasPart ?? input.daysInUk) < 91
  ) {
    return {
      caseNumber: 2,
      splitDate: input.departureDate,
      ukPart: 'pre-split',
      reason: `Case 2: Joining partner overseas from ${input.departureDate}. UK part is before the split date.`,
      applies: true,
    };
  }

  // Case 3: Ceasing to have a UK home
  // Conditions:
  //   (a) Was UK-resident for the previous tax year
  //   (b) Had a UK home at the start of the year but ceases to have one
  //   (c) Has fewer than 91 days in UK in overseas part
  //   (d) Is non-resident in the next tax year
  if (
    input.wasResidentPrevious3Years &&
    input.ceasesUkHome &&
    input.ukHomeCeaseDate &&
    input.willBeNonResidentNextYear &&
    (input.daysInUkDuringOverseasPart ?? input.daysInUk) < 91
  ) {
    return {
      caseNumber: 3,
      splitDate: input.ukHomeCeaseDate,
      ukPart: 'pre-split',
      reason: `Case 3: Ceasing to have a UK home on ${input.ukHomeCeaseDate}. UK part is before the split date.`,
      applies: true,
    };
  }

  // ── ARRIVING CASES (4–8) ──────────────────────────────────────────────

  // Case 4: Starting to have a UK home only
  // Conditions:
  //   (a) Had no UK home previously
  //   (b) Acquires a UK home during the tax year
  //   (c) Has a home in the UK for the rest of the year
  //   (d) Has fewer than 91 UK days before the acquisition
  if (
    !input.wasResidentPrevious3Years &&
    input.acquiresUkHome &&
    input.ukHomeAcquireDate &&
    (input.daysInUkDuringOverseasPart ?? 0) < 91
  ) {
    return {
      caseNumber: 4,
      splitDate: input.ukHomeAcquireDate,
      ukPart: 'post-split',
      reason: `Case 4: Acquiring a UK home on ${input.ukHomeAcquireDate}. UK part is from the split date onwards.`,
      applies: true,
    };
  }

  // Case 5: Starting full-time work in the UK
  // Conditions:
  //   (a) Was non-UK-resident for prior years
  //   (b) Starts full-time work in the UK during the tax year
  //   (c) Has fewer than 91 UK days before the work start
  if (
    !input.wasResidentPrevious3Years &&
    input.startsFullTimeWorkInUk &&
    input.ukWorkStartDate &&
    (input.daysInUkDuringOverseasPart ?? 0) < 91
  ) {
    return {
      caseNumber: 5,
      splitDate: input.ukWorkStartDate,
      ukPart: 'post-split',
      reason: `Case 5: Starting full-time UK work on ${input.ukWorkStartDate}. UK part is from the split date onwards.`,
      applies: true,
    };
  }

  // Case 6: Ceasing full-time work overseas
  // Conditions:
  //   (a) Was working full-time overseas
  //   (b) Ceases to work full-time overseas during the tax year
  //   (c) Becomes UK-resident for the remainder
  if (
    !input.wasResidentPrevious3Years &&
    input.arrivalDate &&
    input.worksFullTimeOverseas // was working overseas, now stopped
  ) {
    return {
      caseNumber: 6,
      splitDate: input.arrivalDate,
      ukPart: 'post-split',
      reason: `Case 6: Ceasing full-time overseas work on ${input.arrivalDate}. UK part is from the split date onwards.`,
      applies: true,
    };
  }

  // Case 7: Partner of someone ceasing full-time work overseas
  if (
    !input.wasResidentPrevious3Years &&
    input.arrivalDate &&
    input.partnerLivesOverseas === false // partner is now in UK
  ) {
    return {
      caseNumber: 7,
      splitDate: input.arrivalDate,
      ukPart: 'post-split',
      reason: `Case 7: Joining partner in the UK from ${input.arrivalDate}. UK part is from the split date onwards.`,
      applies: true,
    };
  }

  // Case 8: Starting to have a UK home
  // (Broader than Case 4 — applies when individual gains a UK home
  //  and was non-resident for the prior 3 years)
  if (
    !input.wasResidentPrevious3Years &&
    input.acquiresUkHome &&
    input.ukHomeAcquireDate &&
    input.hasOverseasHome
  ) {
    return {
      caseNumber: 8,
      splitDate: input.ukHomeAcquireDate,
      ukPart: 'post-split',
      reason: `Case 8: Starting to have a UK home on ${input.ukHomeAcquireDate} (also has overseas home). UK part is from the split date onwards.`,
      applies: true,
    };
  }

  return noSplit;
}

/**
 * Given a split date and the tax year, compute the fraction of the year
 * that falls in the UK part. Used for income apportionment.
 */
export function computeSplitYearFraction(
  taxYear: string,
  splitDate: string,
  ukPart: 'pre-split' | 'post-split'
): number {
  const range = taxYearRange(taxYear);
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const split = new Date(splitDate).getTime();
  
  // Use Math.round to handle DST transitions (1 hour shifts)
  const totalDays = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1; // 365 days
  const preSplitDays = Math.round((split - start) / (24 * 60 * 60 * 1000));

  if (ukPart === 'pre-split') {
    return Math.max(0, Math.min(1, preSplitDays / totalDays));
  } else {
    return Math.max(0, Math.min(1, (totalDays - preSplitDays) / totalDays));
  }
}
