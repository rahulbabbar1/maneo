import { roundToNearestPenny } from '../utils/rounding.js';

export interface FxRateKey {
  currency: string; // ISO 3-letter code, e.g. "USD", "EUR"
  yearMonth: string; // YYYY-MM, e.g. "2025-06"
}

// HMRC monthly exchange rates database
// The rate represents: 1 unit of foreign currency = X units of GBP.
export const HMRC_MONTHLY_RATES: Record<string, Record<string, number>> = {
  'USD': {
    '2025-04': 0.8000,
    '2025-05': 0.8100,
    '2025-06': 0.8000,
    '2025-07': 0.7900,
    '2025-08': 0.7800,
    '2025-09': 0.7900,
    '2025-10': 0.8000,
    '2025-11': 0.8100,
    '2025-12': 0.8200,
    '2026-01': 0.8100,
    '2026-02': 0.8000,
    '2026-03': 0.7900,
    '2026-04': 0.8000,
  },
  'EUR': {
    '2025-04': 0.8500,
    '2025-05': 0.8600,
    '2025-06': 0.8500,
    '2025-07': 0.8400,
    '2025-08': 0.8500,
    '2025-09': 0.8600,
    '2025-10': 0.8500,
    '2025-11': 0.8400,
    '2025-12': 0.8500,
    '2026-01': 0.8600,
    '2026-02': 0.8500,
    '2026-03': 0.8400,
    '2026-04': 0.8500,
  },
  'INR': {
    '2025-04': 0.0095,
    '2025-05': 0.0096,
    '2025-06': 0.0095,
    '2025-07': 0.0094,
    '2025-08': 0.0095,
    '2025-09': 0.0096,
    '2025-10': 0.0095,
    '2025-11': 0.0094,
    '2025-12': 0.0095,
    '2026-01': 0.0096,
    '2026-02': 0.0095,
    '2026-03': 0.0094,
    '2026-04': 0.0095,
  }
};

export function getHmrcMonthlyRate(currency: string, date: string): number {
  const cleanCurrency = currency.toUpperCase();
  if (cleanCurrency === 'GBP') return 1.0;
  
  const yearMonth = date.substring(0, 7); // e.g. "2025-06"
  
  const currencyRates = HMRC_MONTHLY_RATES[cleanCurrency];
  if (!currencyRates) {
    throw new Error(`Exchange rate not found for currency: ${currency}`);
  }
  
  const rate = currencyRates[yearMonth];
  if (rate === undefined) {
    throw new Error(`Exchange rate not found for currency ${currency} in period ${yearMonth}`);
  }
  
  return rate;
}

export function convertToGbp(amount: number, currency: string, date: string): number {
  const rate = getHmrcMonthlyRate(currency, date);
  return Math.round(amount * rate);
}
