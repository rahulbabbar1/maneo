import { TaxYearConfig, TaxBand } from '@uk-sa-app/tax-config';

export interface ComputeIncomeTaxInput {
  region: 'rUK' | 'scotland' | 'wales';
  nonSavingsIncome: number; // pence
  savingsIncome: number;    // pence
  dividendIncome: number;   // pence
  giftAidGrossedUp: number; // pence
  relievablePensionContributions: number; // pence
  blindPersonsAllowanceClaimed: boolean;
}

export interface ComputedTaxBandResult {
  name: string;
  category: 'nonSavings' | 'savings' | 'dividends';
  amountAllocated: number; // pence
  rate: number;
  taxCharged: number;      // pence
}

export interface ComputeIncomeTaxOutput {
  personalAllowance: number;      // pence
  taxableNonSavings: number;      // pence
  taxableSavings: number;         // pence
  taxableDividends: number;        // pence
  allocatedBands: ComputedTaxBandResult[];
  incomeTaxTotal: number;         // pence
}

/**
 * Calculates the personal allowance after applying any taper.
 * Taper reduces the allowance by £1 for every £2 of income over £100,000.
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
 * Allocates taxable income to the relevant tax bands in order of:
 * 1. Non-savings income
 * 2. Savings income
 * 3. Dividend income
 * 
 * Note: Gift aid and relievable pensions extend the basic-rate and higher-rate bands.
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
  } = input;

  // 1. Calculate Adjusted Net Income for personal allowance taper
  // Adjusted net income is total taxable income before personal allowance, minus grossed up gift aid / pension
  const totalGrossIncome = nonSavingsIncome + savingsIncome + dividendIncome;
  const reliefExtension = giftAidGrossedUp + relievablePensionContributions;
  const adjustedNetIncome = Math.max(0, totalGrossIncome - reliefExtension);

  // 2. Compute Personal Allowance
  const personalAllowance = computePersonalAllowance(adjustedNetIncome, config, blindPersonsAllowanceClaimed);

  // 3. Deduct Personal Allowance from income categories (precedence: non-savings, then savings, then dividends)
  let remainingPA = personalAllowance;

  let taxableNonSavings = 0;
  if (nonSavingsIncome > remainingPA) {
    taxableNonSavings = nonSavingsIncome - remainingPA;
    remainingPA = 0;
  } else {
    remainingPA -= nonSavingsIncome;
  }

  let taxableSavings = 0;
  if (savingsIncome > remainingPA) {
    taxableSavings = savingsIncome - remainingPA;
    remainingPA = 0;
  } else {
    remainingPA -= savingsIncome;
  }

  let taxableDividends = 0;
  if (dividendIncome > remainingPA) {
    taxableDividends = dividendIncome - remainingPA;
    remainingPA = 0;
  } else {
    remainingPA -= dividendIncome;
  }

  // 4. Band Allocation
  const rates = config.incomeTax[region] || config.incomeTax.rUK;
  const allocatedBands: ComputedTaxBandResult[] = [];
  let incomeTaxTotal = 0;

  // Band extensions from reliefs (increases the size of basic and higher rate bands)
  const bandOffset = reliefExtension;

  // A helper function to allocate income into bands
  const allocateToBands = (
    amount: number,
    category: 'nonSavings' | 'savings' | 'dividends',
    bands: TaxBand[]
  ) => {
    let remainingAmount = amount;
    let accumulatedLimit = 0;

    for (const band of bands) {
      if (remainingAmount <= 0) break;

      // Adjust band limit based on relief extensions
      const rawLimit = band.limit;
      const adjustedLimit = rawLimit === Infinity ? Infinity : rawLimit + bandOffset;
      const bandWidth = adjustedLimit - accumulatedLimit;

      const allocatedToThisBand = Math.min(remainingAmount, bandWidth);
      if (allocatedToThisBand > 0) {
        const taxCharged = Math.round(allocatedToThisBand * band.rate);
        allocatedBands.push({
          name: band.name,
          category,
          amountAllocated: allocatedToThisBand,
          rate: band.rate,
          taxCharged,
        });
        incomeTaxTotal += taxCharged;
        remainingAmount -= allocatedToThisBand;
      }

      accumulatedLimit = adjustedLimit;
    }
  };

  // Allocating Non-Savings
  allocateToBands(taxableNonSavings, 'nonSavings', rates.nonSavings);

  // Allocating Savings (simplified for skeleton: starting rate and PSA are handled in full implementation)
  // Let's deduct Personal Savings Allowance (PSA)
  let actualTaxableSavings = taxableSavings;
  // If basic rate: PSA is £1,000, if higher: £500, if additional: £0
  // Determine tax band category based on adjusted net income
  let psa = 0;
  const basicRateMax = rates.nonSavings[0].limit + bandOffset;
  const higherRateMax = rates.nonSavings[1].limit + bandOffset;
  if (adjustedNetIncome <= basicRateMax + personalAllowance) {
    psa = config.personalSavingsAllowanceBasic;
  } else if (adjustedNetIncome <= higherRateMax + personalAllowance) {
    psa = config.personalSavingsAllowanceHigher;
  } else {
    psa = config.personalSavingsAllowanceAdditional;
  }

  if (psa > 0 && actualTaxableSavings > 0) {
    const allocatedPsa = Math.min(actualTaxableSavings, psa);
    allocatedBands.push({
      name: 'personal_savings_allowance',
      category: 'savings',
      amountAllocated: allocatedPsa,
      rate: 0.00,
      taxCharged: 0,
    });
    actualTaxableSavings -= allocatedPsa;
  }

  allocateToBands(actualTaxableSavings, 'savings', rates.savings);

  // Allocating Dividends (deduct dividend allowance)
  let actualTaxableDividends = taxableDividends;
  const divAllowance = config.dividendAllowance;
  if (divAllowance > 0 && actualTaxableDividends > 0) {
    const allocatedDivAllowance = Math.min(actualTaxableDividends, divAllowance);
    allocatedBands.push({
      name: 'dividend_allowance',
      category: 'dividends',
      amountAllocated: allocatedDivAllowance,
      rate: 0.00,
      taxCharged: 0,
    });
    actualTaxableDividends -= allocatedDivAllowance;
  }

  allocateToBands(actualTaxableDividends, 'dividends', rates.dividends);

  return {
    personalAllowance,
    taxableNonSavings,
    taxableSavings,
    taxableDividends,
    allocatedBands,
    incomeTaxTotal,
  };
}
