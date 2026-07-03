export interface TaxBand {
  name: string;
  limit: number; // upper limit in pence (e.g. 3770000), Use Infinity for top band
  rate: number;  // multiplier e.g. 0.20
}

export interface IncomeTaxRates {
  nonSavings: TaxBand[];
  savings: TaxBand[];
  dividends: TaxBand[];
}

export interface CapitalGainsRates {
  annualExemptAmount: number; // pence
  basicRate: number;          // e.g. 0.10
  basicRateResidential: number; // e.g. 0.18
  higherRate: number;         // e.g. 0.20
  higherRateResidential: number; // e.g. 0.24
  badrRate: number;           // e.g. 0.10
  badrLifetimeLimit: number;  // pence
}

export interface StudentLoanThreshold {
  threshold: number; // pence
  rate: number;      // e.g. 0.09
}

export interface TaxYearConfig {
  taxYear: string;
  personalAllowance: number;      // pence (1257000)
  personalAllowanceTaperLimit: number; // pence (10000000)
  blindPersonsAllowance: number;  // pence
  marriageAllowanceTransferLimit: number; // pence
  
  dividendAllowance: number;      // pence (50000)
  
  savingsStartingRateLimit: number; // pence (500000)
  savingsStartingRate: number;      // 0.00
  personalSavingsAllowanceBasic: number; // pence (100000)
  personalSavingsAllowanceHigher: number; // pence (50000)
  personalSavingsAllowanceAdditional: number; // pence (0)

  incomeTax: {
    rUK: IncomeTaxRates;
    scotland: IncomeTaxRates;
    wales: IncomeTaxRates;
  };

  capitalGains: CapitalGainsRates;

  hicbc: {
    lowerThreshold: number; // pence (6000000)
    upperThreshold: number; // pence (8000000)
    divisor: number;        // pence (16000) for 1% rate increase
  };

  studentLoans: {
    plan1: StudentLoanThreshold;
    plan2: StudentLoanThreshold;
    plan4: StudentLoanThreshold;
    plan5: StudentLoanThreshold;
    postgrad: StudentLoanThreshold;
  };
}

export const CONFIG_2025_26: TaxYearConfig = {
  taxYear: '2025-26',
  personalAllowance: 1257000,
  personalAllowanceTaperLimit: 10000000,
  blindPersonsAllowance: 307000, // standard value for 2025-26 (approx/verified)
  marriageAllowanceTransferLimit: 126000, // approx

  dividendAllowance: 50000, // £500
  
  savingsStartingRateLimit: 500000, // £5,000
  savingsStartingRate: 0.00,
  personalSavingsAllowanceBasic: 100000, // £1,000
  personalSavingsAllowanceHigher: 50000, // £500
  personalSavingsAllowanceAdditional: 0,

  incomeTax: {
    rUK: {
      nonSavings: [
        { name: 'basic', limit: 3770000, rate: 0.20 },
        { name: 'higher', limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic', limit: 3770000, rate: 0.20 },
        { name: 'higher', limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic', limit: 3770000, rate: 0.0875 },
        { name: 'higher', limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    scotland: {
      // Scottish rates vary on non-savings (bands for 2025-26)
      nonSavings: [
        { name: 'starter', limit: 230600, rate: 0.19 },
        { name: 'basic', limit: 1399100, rate: 0.20 },
        { name: 'intermediate', limit: 3109200, rate: 0.21 },
        { name: 'higher', limit: 6243000, rate: 0.42 },
        { name: 'advanced', limit: 12514000, rate: 0.45 },
        { name: 'top', limit: Infinity, rate: 0.48 },
      ],
      savings: [
        { name: 'basic', limit: 3770000, rate: 0.20 },
        { name: 'higher', limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic', limit: 3770000, rate: 0.0875 },
        { name: 'higher', limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    wales: {
      // Wales matches rUK (10% Welsh rate + 10% UK reduction)
      nonSavings: [
        { name: 'basic', limit: 3770000, rate: 0.20 },
        { name: 'higher', limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic', limit: 3770000, rate: 0.20 },
        { name: 'higher', limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic', limit: 3770000, rate: 0.0875 },
        { name: 'higher', limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
  },

  capitalGains: {
    annualExemptAmount: 300000, // £3,000
    basicRate: 0.10,
    basicRateResidential: 0.18,
    higherRate: 0.20,
    higherRateResidential: 0.24,
    badrRate: 0.10,
    badrLifetimeLimit: 100000000, // £1,000,000
  },

  hicbc: {
    lowerThreshold: 6000000, // £60,000
    upperThreshold: 8000000, // £80,000
    divisor: 16000,          // £160
  },

  studentLoans: {
    plan1: { threshold: 2493000, rate: 0.09 },
    plan2: { threshold: 2729500, rate: 0.09 },
    plan4: { threshold: 3139500, rate: 0.09 },
    plan5: { threshold: 2527500, rate: 0.09 },
    postgrad: { threshold: 2100000, rate: 0.06 },
  },
};

export const CONFIGS: Record<string, TaxYearConfig> = {
  '2025-26': CONFIG_2025_26,
};

export function getConfig(taxYear: string): TaxYearConfig {
  const config = CONFIGS[taxYear];
  if (!config) {
    throw new Error(`Tax year configuration not found for: ${taxYear}`);
  }
  return config;
}
