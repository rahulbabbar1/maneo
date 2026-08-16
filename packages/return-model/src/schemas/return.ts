import { z } from 'zod';

export const SA100Schema = z.object({
  // Gross UK (domestic) investment income. Foreign equivalents live on SA106.
  income: z.object({
    ukSavingsIncome: z.number().int().nonnegative().default(0),   // gross interest, pence
    ukDividendIncome: z.number().int().nonnegative().default(0),  // gross dividends, pence
  }).optional(),
  taxAlreadyPaid: z.object({
    payeTax: z.number().int().nonnegative().default(0),
    taxDeductedFromSavings: z.number().int().nonnegative().default(0),
    taxDeductedFromDividends: z.number().int().nonnegative().default(0),
    cisDeductions: z.number().int().nonnegative().default(0),
    otherTaxPaid: z.number().int().nonnegative().default(0),
  }).default({}),
  reliefs: z.object({
    giftAidGrossedUp: z.number().int().nonnegative().default(0),
    relievablePensionContributions: z.number().int().nonnegative().default(0),
    blindPersonsAllowance: z.boolean().default(false),
    marriageAllowanceTransferor: z.boolean().default(false),
    marriageAllowanceRecipient: z.boolean().default(false),
  }).default({}),
});

export const SA102Schema = z.object({
  employerName: z.string().min(1),
  employerRef: z.string().optional(),
  grossPay: z.number().int().nonnegative(),
  taxDeducted: z.number().int().nonnegative(),
  benefits: z.object({
    companyCars: z.number().int().nonnegative().default(0),
    medicalInsurance: z.number().int().nonnegative().default(0),
    otherBenefits: z.number().int().nonnegative().default(0),
  }).default({}),
  expenses: z.object({
    businessTravel: z.number().int().nonnegative().default(0),
    professionalFees: z.number().int().nonnegative().default(0),
    otherExpenses: z.number().int().nonnegative().default(0),
  }).default({}),
});

export const ForeignIncomeItemSchema = z.object({
  countryCode: z.string().length(3), // ISO 3166-1 alpha-3
  incomeType: z.enum(['savings', 'dividends', 'employment', 'property', 'other']),
  grossAmount: z.number().int().nonnegative(),
  foreignTaxPaid: z.number().int().nonnegative().default(0),
  taxTreatyRateLimit: z.number().min(0).max(1).optional(), // e.g. 0.15 for 15%
  claimFtcr: z.boolean().default(true),
  // ── FX conversion fields (A6) ──────────────────────────────────────────
  currency: z.string().length(3).optional(),
  originalGrossAmount: z.number().int().nonnegative().optional(),
  originalForeignTaxPaid: z.number().int().nonnegative().optional(),
  transactionDate: z.string().optional(),
});

export const SA106Schema = z.object({
  foreignIncome: z.array(ForeignIncomeItemSchema).default([]),
  remittanceBasis: z.object({
    claimRemittanceBasis: z.boolean().default(false),
    remittedAmount: z.number().int().nonnegative().default(0),
    remittanceChargePaid: z.number().int().nonnegative().default(0),
  }).default({}),
});

export const AcquisitionDetailSchema = z.object({
  date: z.string(),
  quantity: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative(),
});

export const Section104PoolSchema = z.object({
  poolId: z.string(),
  poolQuantity: z.number().int().nonnegative(),
  poolCost: z.number().int().nonnegative(),
});

export const CapitalGainsDisposalSchema = z.object({
  assetType: z.enum(['residential_property', 'other_property', 'listed_shares', 'unlisted_shares', 'other']),
  disposalDate: z.string(), // YYYY-MM-DD
  proceeds: z.number().int().nonnegative(),
  costs: z.number().int().nonnegative().default(0),
  losses: z.number().int().nonnegative().default(0),
  claimBadr: z.boolean().default(false),
  quantity: z.number().int().nonnegative().optional(),
  acquisitions: z.array(AcquisitionDetailSchema).optional(),
});

export const SA108Schema = z.object({
  disposals: z.array(CapitalGainsDisposalSchema).default([]),
  broughtForwardLosses: z.number().int().nonnegative().default(0),
  section104Pools: z.array(Section104PoolSchema).optional(),
});

export const SA109Schema = z.object({
  residenceStatus: z.object({
    daysInUk: z.number().int().nonnegative(),
    srtResult: z.enum(['resident', 'non_resident', 'split_year']),
    splitYearCase: z.number().int().min(1).max(8).optional(),
    domicileStatus: z.enum(['uk_domiciled', 'foreign_domiciled']),
    figRegimeElected: z.boolean().default(false),
    overseasWorkdayReliefClaimed: z.boolean().default(false),
    /** Whether the individual was UK-resident in any of the 3 preceding tax years. */
    wasResidentPrevious3Years: z.boolean().optional(),
    /** Whether the individual was non-UK-resident for the 10 preceding tax years (FIG eligibility). */
    nonResidentPrevious10Years: z.boolean().optional(),
    // ── Split-year detail fields (A4) ────────────────────────────────────
    /** Date the individual departed the UK (YYYY-MM-DD), for leaving cases. */
    departureDate: z.string().optional(),
    /** Date the individual arrived in the UK (YYYY-MM-DD), for arriving cases. */
    arrivalDate: z.string().optional(),
  }),
});

export const SA101Schema = z.object({
  highIncomeChildBenefitCharge: z.object({
    incomeOverThreshold: z.boolean().default(false),
    numberOfChildren: z.number().int().nonnegative().default(0),
    benefitAmountReceived: z.number().int().nonnegative().default(0),
  }).default({}),
  studentLoan: z.object({
    planType: z.enum(['plan_1', 'plan_2', 'plan_4', 'plan_5', 'postgraduate', 'none']).default('none'),
  }).default({}),
});

export const ClientDetailsSchema = z.object({
  utr: z.string().regex(/^\d{10}$/, 'UTR must be exactly 10 digits').optional(),
  nino: z.string().regex(/^[A-Z]{2}\d{6}[A-D]$/i, 'Invalid NINO format').optional(),
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  dateOfBirth: z.string().optional(), // YYYY-MM-DD
  address: z.object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});

export const ReturnSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string(),
  taxYear: z.string(),
  status: z.enum(['draft', 'review', 'ready', 'submitting', 'submitted', 'accepted', 'rejected']),
  clientDetails: ClientDetailsSchema.optional(),
  sa100: SA100Schema.default({}),
  sa102: z.array(SA102Schema).default([]),
  sa106: SA106Schema.optional(),
  sa108: SA108Schema.optional(),
  sa109: SA109Schema.optional(),
  sa101: SA101Schema.optional(),
  updatedAt: z.string().datetime(),
});

export type SA100 = z.infer<typeof SA100Schema>;
export type SA102 = z.infer<typeof SA102Schema>;
export type ForeignIncomeItem = z.infer<typeof ForeignIncomeItemSchema>;
export type SA106 = z.infer<typeof SA106Schema>;
export type CapitalGainsDisposal = z.infer<typeof CapitalGainsDisposalSchema>;
export type SA108 = z.infer<typeof SA108Schema>;
export type SA109 = z.infer<typeof SA109Schema>;
export type SA101 = z.infer<typeof SA101Schema>;
export type ClientDetails = z.infer<typeof ClientDetailsSchema>;
export type Return = z.infer<typeof ReturnSchema>;

