/**
 * HMRC-specific rounding conventions.
 *
 * HMRC works in whole pounds for income items (rounded down) and keeps pence
 * for tax liability or tax deducted. This utility provides standard rounding
 * methods to ensure identical matching with the HMRC MTR-Tester and Gateway.
 */

/**
 * Rounds an amount in pence DOWN to the nearest whole pound (nearest 100p).
 * Used for all gross income sources (employment, savings interest, dividends).
 */
export function roundDownToPound(pence: number): number {
  return pence - (pence % 100);
}

/**
 * Rounds an amount in pence UP to the nearest whole pound.
 */
export function roundUpToPound(pence: number): number {
  const rem = pence % 100;
  return rem === 0 ? pence : pence + (100 - rem);
}

/**
 * Standard rounding to nearest pence (closest integer).
 */
export function roundToNearestPenny(pence: number): number {
  return Math.round(pence);
}

/**
 * Rounds down to the nearest penny (standard HMRC floor for certain deductions).
 */
export function roundDownToNearestPenny(pence: number): number {
  return Math.floor(pence);
}
