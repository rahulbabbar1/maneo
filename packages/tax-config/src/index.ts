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
    divisor: number;        // pence per 1% of charge (20000 = £200 from 2024-25)
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
    divisor: 20000,          // £200 per 1% (2024-25 onward). [VERIFY-AT-BUILD]
  },

  studentLoans: {
    plan1: { threshold: 2493000, rate: 0.09 },
    plan2: { threshold: 2729500, rate: 0.09 },
    plan4: { threshold: 3139500, rate: 0.09 },
    plan5: { threshold: 2527500, rate: 0.09 },
    postgrad: { threshold: 2100000, rate: 0.06 },
  },
};

// -----------------------------------------------------------------------------
// CONFIG_2024_25 — constants verified against HMRC's official
// "MTR-Tester-2024-25 v2.4.1" ('data' sheet) on this pass.
// -----------------------------------------------------------------------------
export const CONFIG_2024_25: TaxYearConfig = {
  taxYear: '2024-25',
  personalAllowance: 1257000,           // £12,570 — frozen (HMRC P_A)
  personalAllowanceTaperLimit: 10000000, // £100,000 (HMRC PA_taper_limit)
  blindPersonsAllowance: 307000,        // £3,070 (HMRC BPA)
  marriageAllowanceTransferLimit: 126000, // £1,260 (HMRC T_P_A)

  dividendAllowance: 50000,             // £500 (HMRC DA)

  savingsStartingRateLimit: 500000,     // £5,000 (HMRC SR_band)
  savingsStartingRate: 0.00,
  personalSavingsAllowanceBasic: 100000,   // £1,000 (HMRC PSA_BR)
  personalSavingsAllowanceHigher: 50000,   // £500 (HMRC PSA_HR)
  personalSavingsAllowanceAdditional: 0,

  incomeTax: {
    rUK: {
      // basic band 0–£37,700 (BR_band); additional-rate threshold £125,140 (AHR_band)
      nonSavings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    scotland: {
      nonSavings: [
        { name: 'starter',      limit: 214000,  rate: 0.19 },
        { name: 'basic',        limit: 1332100, rate: 0.20 },
        { name: 'intermediate', limit: 3110000, rate: 0.21 },
        { name: 'higher',       limit: 6244000, rate: 0.42 },
        { name: 'advanced',     limit: 12514000, rate: 0.45 },
        { name: 'top',          limit: Infinity, rate: 0.48 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    wales: {
      nonSavings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
  },

  capitalGains: {
    // NOTE: from 30 Oct 2024 the non-residential lower/higher rates rose to
    // 18%/24%. This single-rate model uses the pre-budget 10%/20%; the mid-year
    // split (box CGT51) is not yet modelled. [gap]
    annualExemptAmount: 300000,         // £3,000 (HMRC CG_exempt)
    basicRate: 0.10,
    basicRateResidential: 0.18,
    higherRate: 0.20,
    higherRateResidential: 0.24,
    badrRate: 0.10,
    badrLifetimeLimit: 100000000,       // £1,000,000
  },

  hicbc: {
    lowerThreshold: 6000000,            // £60,000 (HMRC CBC_HR_threshold; full charge at £80,000)
    upperThreshold: 8000000,            // £80,000
    divisor: 20000,                     // £200 per 1% (verified: full charge at £80,000)
  },

  studentLoans: {
    plan1: { threshold: 2499000, rate: 0.09 },  // £24,990 (HMRC SL_limit1)
    plan2: { threshold: 2729500, rate: 0.09 },  // £27,295 (HMRC SL_limit2)
    plan4: { threshold: 3139500, rate: 0.09 },  // £31,395 (HMRC SL_limit4)
    plan5: { threshold: 2527500, rate: 0.09 },  // Plan 5 repayments start Apr 2026; N/A for 2024-25
    postgrad: { threshold: 2100000, rate: 0.06 }, // £21,000 (HMRC PGL_limit)
  },
};

export const CONFIG_2023_24: TaxYearConfig = {
  taxYear: '2023-24',
  blindPersonsAllowance: 295000,        // [UNVERIFIED] needs 2023-24 Tester
  personalAllowance: 1257000,
  personalAllowanceTaperLimit: 10000000,
  marriageAllowanceTransferLimit: 126000, // £1,260

  dividendAllowance: 100000,            // £1,000 (was £2k before 2023-24)

  savingsStartingRateLimit: 500000,
  savingsStartingRate: 0.00,
  personalSavingsAllowanceBasic: 100000,
  personalSavingsAllowanceHigher: 50000,
  personalSavingsAllowanceAdditional: 0,

  incomeTax: {
    rUK: {
      nonSavings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    scotland: {
      nonSavings: [
        { name: 'starter',      limit: 214000,  rate: 0.19 },
        { name: 'basic',        limit: 1332100, rate: 0.20 },
        { name: 'intermediate', limit: 3110000, rate: 0.21 },
        { name: 'higher',       limit: 6244000, rate: 0.42 },
        { name: 'top',          limit: Infinity, rate: 0.47 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
    wales: {
      nonSavings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      savings: [
        { name: 'basic',      limit: 3770000,  rate: 0.20 },
        { name: 'higher',     limit: 12514000, rate: 0.40 },
        { name: 'additional', limit: Infinity, rate: 0.45 },
      ],
      dividends: [
        { name: 'basic',      limit: 3770000,  rate: 0.0875 },
        { name: 'higher',     limit: 12514000, rate: 0.3375 },
        { name: 'additional', limit: Infinity, rate: 0.3935 },
      ],
    },
  },

  capitalGains: {
    annualExemptAmount: 600000,         // £6,000
    basicRate: 0.10,
    basicRateResidential: 0.18,
    higherRate: 0.20,
    higherRateResidential: 0.28,
    badrRate: 0.10,
    badrLifetimeLimit: 100000000,
  },

  hicbc: {
    lowerThreshold: 5000000,            // £50,000 (old threshold before 2024-25 change)
    upperThreshold: 6000000,            // £60,000
    divisor: 10000,
  },

  studentLoans: {
    // [UNVERIFIED for 2023-24] needs the 2023-24 Tester to confirm
    plan1: { threshold: 2275000, rate: 0.09 },
    plan2: { threshold: 2729500, rate: 0.09 },
    plan4: { threshold: 2775000, rate: 0.09 },
    plan5: { threshold: 2527500, rate: 0.09 },
    postgrad: { threshold: 2100000, rate: 0.06 },
  },
};

export const CONFIGS: Record<string, TaxYearConfig> = {
  '2025-26': CONFIG_2025_26,
  '2024-25': CONFIG_2024_25,
  '2023-24': CONFIG_2023_24,
};

export function getConfig(taxYear: string): TaxYearConfig {
  const config = CONFIGS[taxYear];
  if (!config) {
    throw new Error(`Tax year configuration not found for: ${taxYear}`);
  }
  return config;
}

/**
 * Deterministic hash of a TaxYearConfig, embedded in every computation's
 * version block so the figures on screen/filed can be traced to an exact
 * rates/thresholds snapshot (spec 4.2 / 4.7). FNV-1a over canonical JSON;
 * pure and dependency-free so it runs in any environment.
 */
export function configHash(config: TaxYearConfig): string {
  const json = JSON.stringify(config, (_k, v) => (v === Infinity ? 'Infinity' : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
