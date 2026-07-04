import { TaxYearConfig } from '@uk-sa-app/tax-config';

/**
 * Fabrication guardrail (spec 6.2).
 *
 * The model must never assert a monetary figure that did not come from a
 * calculation tool. This module builds the set of "allowed" figures from the
 * latest computation plus the public rate/threshold constants for the tax year
 * (so the model can still explain rules like the £100,000 taper), then redacts
 * any out-of-set monetary figure from a model reply.
 *
 * This is intentionally conservative: it redacts rather than silently trusting.
 * Tune the tolerance / ignore rules against real transcripts.
 */

const POUND_TOLERANCE = 1; // allow ±£1 for rounding/formatting differences

function addValue(set: number[], pence: number | undefined) {
  if (typeof pence !== 'number' || !isFinite(pence)) return;
  set.push(Math.round(pence) / 100);
}

/** Collect every monetary figure the computation legitimately produced. */
export function buildAllowedFigures(calc: any, config?: TaxYearConfig): number[] {
  const allowed: number[] = [];
  if (calc?.incomeTax) {
    addValue(allowed, calc.incomeTax.personalAllowance);
    addValue(allowed, calc.incomeTax.incomeTaxTotal);
    addValue(allowed, calc.incomeTax.taxableNonSavings);
    addValue(allowed, calc.incomeTax.taxableSavings);
    addValue(allowed, calc.incomeTax.taxableDividends);
    for (const b of calc.incomeTax.allocatedBands || []) {
      addValue(allowed, b.amountAllocated);
      addValue(allowed, b.taxCharged);
    }
  }
  if (calc?.cgt) {
    addValue(allowed, calc.cgt.taxableGain);
    addValue(allowed, calc.cgt.totalCgtDue);
    for (const b of calc.cgt.breakdown || []) addValue(allowed, b.taxCharged);
  }
  if (calc?.ftcr) {
    addValue(allowed, calc.ftcr.totalForeignTaxPaid);
    addValue(allowed, calc.ftcr.totalAllowedCredit);
  }
  if (calc?.charges) {
    addValue(allowed, calc.charges.hicbcAmount);
    addValue(allowed, calc.charges.studentLoanRepayment);
    addValue(allowed, calc.charges.studentLoanBalanceDue);
  }
  addValue(allowed, calc?.taxAlreadyPaidTotal);
  addValue(allowed, calc?.balancingPayment);
  addValue(allowed, calc?.nextYearPaymentOnAccount);

  // Public rule constants so legitimate rule explanations are not redacted.
  if (config) {
    addValue(allowed, config.personalAllowance);
    addValue(allowed, config.personalAllowanceTaperLimit);
    addValue(allowed, config.dividendAllowance);
    addValue(allowed, config.personalSavingsAllowanceBasic);
    addValue(allowed, config.personalSavingsAllowanceHigher);
    addValue(allowed, config.savingsStartingRateLimit);
    addValue(allowed, config.capitalGains.annualExemptAmount);
    addValue(allowed, config.hicbc.lowerThreshold);
    addValue(allowed, config.hicbc.upperThreshold);
  }
  return allowed;
}

const MONEY_RE = /£\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

/** True if `amount` is within tolerance of any allowed figure. */
function isAllowed(amount: number, allowed: number[]): boolean {
  return allowed.some(a => Math.abs(a - amount) <= POUND_TOLERANCE);
}

/**
 * Redacts any £-prefixed figure in `text` that is not in the allowed set.
 * Only £-prefixed numbers are checked, so years / day counts / percentages are
 * left alone. Returns the sanitized text and whether anything was redacted.
 */
export function enforceFigureGuardrail(
  text: string,
  calc: any,
  config?: TaxYearConfig
): { text: string; redacted: boolean } {
  if (!text) return { text, redacted: false };
  const allowed = buildAllowedFigures(calc, config);
  let redacted = false;

  const sanitized = text.replace(MONEY_RE, (match, num: string) => {
    const amount = parseFloat(num.replace(/,/g, ''));
    if (!isFinite(amount)) return match;
    if (isAllowed(amount, allowed)) return match;
    redacted = true;
    return '[unverified figure removed]';
  });

  return { text: sanitized, redacted };
}
