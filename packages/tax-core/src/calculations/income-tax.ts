import { TaxYearConfig, TaxBand } from '@uk-sa-app/tax-config';

export interface ComputeIncomeTaxInput {
  region: 'rUK' | 'scotland' | 'wales';
  nonSavingsIncome: number; // pence
  savingsIncome: number;    // pence
  dividendIncome: number;   // pence
  giftAidGrossedUp: number; // pence
  relievablePensionContributions: number; // pence
  blindPersonsAllowanceClaimed: boolean;
  marriageAllowanceTransferor?: boolean; // gives away part of PA
  marriageAllowanceRecipient?: boolean;  // receives a tax reducer
}

export interface ComputedTaxBandResult {
  name: string;
  category: 'nonSavings' | 'savings' | 'dividends';
  amountAllocated: number; // pence
  rate: number;
  taxCharged: number;      // pence
}

export interface ComputeIncomeTaxOutput {
  personalAllowance: number;      // pence (after taper and any marriage transfer)
  taxableNonSavings: number;      // pence
  taxableSavings: number;         // pence
  taxableDividends: number;       // pence
  allocatedBands: ComputedTaxBandResult[];
  marriageAllowanceReducer: number; // pence, subtracted from the total
  incomeTaxTotal: number;         // pence (after marriage-allowance reducer)
}

/**
 * Personal allowance after the £1-for-£2 taper over the taper limit.
 * (Marriage-allowance transfer and blind person's allowance are applied by the
 * caller, computeIncomeTax, so this stays a pure taper function.)
 */
export function computePersonalAllowance(
  adjustedNetIncome: number,
  config: TaxYearConfig,
  blindPersonsAllowanceClaimed: boolean = false
): number {
  let allowance = config.personalAllowance;

  if (adjustedNetIncome > config.personalAllowanceTaperLimit) {
    const excess = adjustedNetIncome - config.personalAllowanceTaperLimit;
    const reduction = Math.floor(excess / 2);
    allowance = Math.max(0, allowance - reduction);
  }

  if (blindPersonsAllowanceClaimed) {
    allowance += config.blindPersonsAllowance;
  }

  return allowance;
}

/**
 * Income tax with correct band STACKING: non-savings, then savings, then
 * dividends are placed on a single shared band cursor, so savings/dividends are
 * taxed at the taxpayer's marginal position rather than each restarting from the
 * basic-rate band. 0%-rate allowances (starting rate for savings, PSA, dividend
 * allowance) still consume band space, matching HMRC.
 */
export function computeIncomeTax(
  input: ComputeIncomeTaxInput,
  config: TaxYearConfig
): ComputeIncomeTaxOutput {
  const {
    region,
    nonSavingsIncome,
    savingsIncome,
    dividendIncome,
    giftAidGrossedUp,
    relievablePensionContributions,
    blindPersonsAllowanceClaimed,
    marriageAllowanceTransferor = false,
    marriageAllowanceRecipient = false,
  } = input;

  // 1. Adjusted net income for the taper (net of grossed-up gift aid / pension).
  const totalGrossIncome = nonSavingsIncome + savingsIncome + dividendIncome;
  const reliefExtension = giftAidGrossedUp + relievablePensionContributions;
  const adjustedNetIncome = Math.max(0, totalGrossIncome - reliefExtension);

  // 2. Personal allowance, then apply marriage-allowance transfer if giving away.
  let personalAllowance = computePersonalAllowance(adjustedNetIncome, config, blindPersonsAllowanceClaimed);
  if (marriageAllowanceTransferor) {
    personalAllowance = Math.max(0, personalAllowance - config.marriageAllowanceTransferLimit);
  }

  // 3. Deduct PA against categories in precedence order.
  let remainingPA = personalAllowance;

  let taxableNonSavings = 0;
  if (nonSavingsIncome > remainingPA) { taxableNonSavings = nonSavingsIncome - remainingPA; remainingPA = 0; }
  else { remainingPA -= nonSavingsIncome; }

  let taxableSavings = 0;
  if (savingsIncome > remainingPA) { taxableSavings = savingsIncome - remainingPA; remainingPA = 0; }
  else { remainingPA -= savingsIncome; }

  let taxableDividends = 0;
  if (dividendIncome > remainingPA) { taxableDividends = dividendIncome - remainingPA; remainingPA = 0; }
  else { remainingPA -= dividendIncome; }

  // 4. Band allocation on a SHARED cursor.
  const rates = config.incomeTax[region] || config.incomeTax.rUK;
  const bandOffset = reliefExtension; // gift aid / pension extend the finite bands
  const allocatedBands: ComputedTaxBandResult[] = [];
  let incomeTaxTotal = 0;

  // `cursor` = cumulative taxable income already placed into bands (all categories).
  let cursor = 0;

  const upperOf = (band: TaxBand) =>
    band.limit === Infinity ? Infinity : band.limit + bandOffset;

  // Allocate `amount` across `bands` starting at the current cursor position.
  const allocate = (
    amount: number,
    category: 'nonSavings' | 'savings' | 'dividends',
    bands: TaxBand[]
  ) => {
    let remaining = amount;
    for (const band of bands) {
      if (remaining <= 0) break;
      const upper = upperOf(band);
      if (cursor >= upper) continue; // band already consumed by lower income
      const space = upper - cursor;
      const take = Math.min(remaining, space);
      if (take <= 0) continue;
      const taxCharged = Math.round(take * band.rate);
      allocatedBands.push({ name: band.name, category, amountAllocated: take, rate: band.rate, taxCharged });
      incomeTaxTotal += taxCharged;
      remaining -= take;
      cursor += take;
    }
  };

  // Place a 0%-rate allowance that still consumes band space at the cursor.
  const allocateZeroRate = (
    amount: number,
    category: 'nonSavings' | 'savings' | 'dividends',
    name: string
  ) => {
    if (amount <= 0) return;
    allocatedBands.push({ name, category, amountAllocated: amount, rate: 0, taxCharged: 0 });
    cursor += amount;
  };

  // 4a. Non-savings.
  allocate(taxableNonSavings, 'nonSavings', rates.nonSavings);

  // 4b. Savings: starting rate for savings, then PSA, then normal bands.
  let remainingSavings = taxableSavings;

  // Starting rate band (£5,000) is reduced £-for-£ by taxable non-savings income.
  const startingRateRoom = Math.max(0, config.savingsStartingRateLimit - taxableNonSavings);
  const startingAmount = Math.min(remainingSavings, startingRateRoom);
  allocateZeroRate(startingAmount, 'savings', 'savings_starting_rate');
  remainingSavings -= startingAmount;

  // PSA tier is determined by UK-wide thresholds regardless of region.
  const ukBands = config.incomeTax.rUK.nonSavings;
  const ukBasicUpper = ukBands[0].limit + bandOffset;
  const ukHigherUpper = ukBands[1].limit + bandOffset;
  const totalTaxable = taxableNonSavings + taxableSavings + taxableDividends;
  let psa: number;
  if (totalTaxable <= ukBasicUpper) psa = config.personalSavingsAllowanceBasic;
  else if (totalTaxable <= ukHigherUpper) psa = config.personalSavingsAllowanceHigher;
  else psa = config.personalSavingsAllowanceAdditional;

  const psaAmount = Math.min(remainingSavings, psa);
  allocateZeroRate(psaAmount, 'savings', 'personal_savings_allowance');
  remainingSavings -= psaAmount;

  allocate(remainingSavings, 'savings', rates.savings);

  // 4c. Dividends: dividend allowance (0%), then normal dividend bands.
  let remainingDividends = taxableDividends;
  const divAllowanceAmount = Math.min(remainingDividends, config.dividendAllowance);
  allocateZeroRate(divAllowanceAmount, 'dividends', 'dividend_allowance');
  remainingDividends -= divAllowanceAmount;

  allocate(remainingDividends, 'dividends', rates.dividends);

  // 5. Marriage-allowance recipient tax reducer: 20% of the transferable amount,
  //    capped at the tax otherwise due (it cannot create a refund).
  let marriageAllowanceReducer = 0;
  if (marriageAllowanceRecipient) {
    const reducer = Math.round(config.marriageAllowanceTransferLimit * 0.20);
    marriageAllowanceReducer = Math.min(incomeTaxTotal, reducer);
    incomeTaxTotal -= marriageAllowanceReducer;
  }

  return {
    personalAllowance,
    taxableNonSavings,
    taxableSavings,
    taxableDividends,
    allocatedBands,
    marriageAllowanceReducer,
    incomeTaxTotal,
  };
}
