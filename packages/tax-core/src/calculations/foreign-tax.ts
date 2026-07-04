import { TaxYearConfig } from '@uk-sa-app/tax-config';
import { roundToNearestPenny } from '../utils/rounding.js';

export interface ForeignIncomeInput {
  countryCode: string; // e.g. "IND"
  incomeType: 'savings' | 'dividends' | 'employment' | 'property' | 'other';
  grossAmount: number; // pence
  foreignTaxPaid: number; // pence
  claimFtcr: boolean;
}

export interface FtcrInput {
  foreignItems: ForeignIncomeInput[];
  ukTaxOnForeignIncome: Record<string, number>; // Maps index/country to UK tax charged on that specific income
}

export interface FtcrItemResult {
  countryCode: string;
  incomeType: string;
  grossAmount: number;
  foreignTaxPaid: number;
  treatyRateLimitApplied?: number;
  relievableForeignTax: number;
  ukTaxOnThisIncome: number;
  allowedCredit: number;
}

export interface FtcrResult {
  totalForeignTaxPaid: number;
  totalAllowedCredit: number;
  items: FtcrItemResult[];
}

// 1. Double Taxation Agreement (DTA) rules database
export const DTA_TREATY_RATES: Record<string, Partial<Record<string, number>>> = {
  // UK-India treaty (Withholding caps on dividends)
  'IND': {
    'dividends': 0.15, // 15% cap
    'savings': 0.15,   // 15% cap for interest
  },
  // UK-US treaty
  'USA': {
    'dividends': 0.15,
    'savings': 0.00, // 0% withholding under treaty for interest in many cases
  },
};

/**
 * Calculates Foreign Tax Credit Relief (FTCR) for each foreign income item.
 * Ensures the foreign tax is capped at DTA limits, and further capped at
 * the UK tax charged on that specific income source.
 */
export function computeFtcr(input: FtcrInput, _config: TaxYearConfig): FtcrResult {
  const { foreignItems, ukTaxOnForeignIncome } = input;
  const items: FtcrItemResult[] = [];
  let totalForeignTaxPaid = 0;
  let totalAllowedCredit = 0;

  foreignItems.forEach((item, index) => {
    totalForeignTaxPaid += item.foreignTaxPaid;

    if (!item.claimFtcr) {
      items.push({
        countryCode: item.countryCode,
        incomeType: item.incomeType,
        grossAmount: item.grossAmount,
        foreignTaxPaid: item.foreignTaxPaid,
        relievableForeignTax: 0,
        ukTaxOnThisIncome: 0,
        allowedCredit: 0,
      });
      return;
    }

    // Determine DTA limit (if any)
    const countryTreaty = DTA_TREATY_RATES[item.countryCode];
    const treatyLimit = countryTreaty ? countryTreaty[item.incomeType] : undefined;

    let relievableForeignTax = item.foreignTaxPaid;
    if (treatyLimit !== undefined) {
      const maxForeignTaxAllowed = roundToNearestPenny(item.grossAmount * treatyLimit);
      relievableForeignTax = Math.min(item.foreignTaxPaid, maxForeignTaxAllowed);
    }

    // Retrieve UK tax calculated for this specific source
    const key = `${item.countryCode}_${item.incomeType}_${index}`;
    const ukTax = ukTaxOnForeignIncome[key] || 0;

    // FTCR is the lower of the relievable foreign tax and the UK tax on that source
    const allowedCredit = Math.min(relievableForeignTax, ukTax);
    totalAllowedCredit += allowedCredit;

    items.push({
      countryCode: item.countryCode,
      incomeType: item.incomeType,
      grossAmount: item.grossAmount,
      foreignTaxPaid: item.foreignTaxPaid,
      treatyRateLimitApplied: treatyLimit,
      relievableForeignTax,
      ukTaxOnThisIncome: ukTax,
      allowedCredit,
    });
  });

  return {
    totalForeignTaxPaid,
    totalAllowedCredit,
    items,
  };
}
