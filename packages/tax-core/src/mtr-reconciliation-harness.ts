/**
 * MTR Reconciliation Harness — anchored to EXTERNAL TRUTH.
 *
 * This replaces the previous self-referential harness that graded tax-core
 * against tax-core. Golden vectors come from the HMRC MTR-Tester spreadsheets
 * and Calculate Tax and NIC methodology, and are frozen in mtr-golden-vectors.ts.
 *
 * Contract:
 *   - Every figure is asserted to the penny.
 *   - A deliberately corrupted constant must make the harness fail.
 *   - No assertion may derive its expected value from tax-core.
 *   - If a new box/field is added to tax-core, a corresponding golden vector
 *     MUST be added before the field can be considered correct.
 */

import { computeFullReturn, FullReturnComputation } from './calculations/assembler.js';
import { getConfig } from '@uk-sa-app/tax-config';
import { MtrGoldenVector, ExpectedFigure, MTR_GOLDEN_VECTORS } from './mtr-golden-vectors.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MtrReconciliationDiff {
  box: string;
  expectedPence: number;
  actualPence: number;
  diffPence: number;
  methodologyRef: string;
}

export interface MtrReconciliationResult {
  vectorName: string;
  taxYear: string;
  passed: boolean;
  diffs: MtrReconciliationDiff[];
}

export interface MtrHarnessReport {
  totalVectors: number;
  passed: number;
  failed: number;
  results: MtrReconciliationResult[];
  selfTestPassed: boolean;
}

// ─── Field extractor ────────────────────────────────────────────────────────

/**
 * Extracts a numeric value from a FullReturnComputation by box name.
 * Maps HMRC-style box references to the tax-core output structure.
 *
 * Returns the value in pence, or undefined if the field is not found.
 */
function extractActualValue(calc: FullReturnComputation, box: string): number | undefined {
  switch (box) {
    // Income tax
    case 'personalAllowance':      return calc.incomeTax.personalAllowance;
    case 'taxableNonSavings':      return calc.incomeTax.taxableNonSavings;
    case 'taxableSavings':         return calc.incomeTax.taxableSavings;
    case 'taxableDividends':       return calc.incomeTax.taxableDividends;
    case 'incomeTaxTotal':         return calc.incomeTax.incomeTaxTotal;
    case 'marriageAllowanceReducer': return calc.incomeTax.marriageAllowanceReducer;

    // Capital gains
    case 'cgt.totalCgtDue':        return calc.cgt?.totalCgtDue;
    case 'cgt.taxableGain':        return calc.cgt?.taxableGain;
    case 'cgt.totalGainBeforeLosses': return calc.cgt?.totalGainBeforeLosses;
    case 'cgt.annualExemptAmountApplied': return calc.cgt?.annualExemptAmountApplied;

    // FTCR
    case 'ftcr.totalAllowedCredit': return calc.ftcr?.totalAllowedCredit;
    case 'ftcr.totalForeignTaxPaid': return calc.ftcr?.totalForeignTaxPaid;

    // Charges
    case 'hicbcAmount':            return calc.charges.hicbcAmount;
    case 'hicbcPercentage':        return Math.round(calc.charges.hicbcPercentage * 100);
    case 'studentLoanBalanceDue':  return calc.charges.studentLoanBalanceDue;

    // Top-level
    case 'totalIncome':            return calc.totalIncome;
    case 'adjustedNetIncome':      return calc.adjustedNetIncome;
    case 'taxAlreadyPaidTotal':    return calc.taxAlreadyPaidTotal;
    case 'balancingPayment':       return calc.balancingPayment;
    case 'paymentsOnAccountRequired': return calc.paymentsOnAccountRequired ? 1 : 0;
    case 'nextYearPaymentOnAccount': return calc.nextYearPaymentOnAccount;

    // Residence
    case 'figRegimeElected':       return calc.figRegimeElected ? 1 : 0;
    case 'figRefused':             return calc.figRefusalReason ? 1 : 0;
    case 'splitYearCase':          return calc.splitYearCase ?? -1;

    default:
      return undefined;
  }
}

// ─── Core reconciliation ────────────────────────────────────────────────────

/**
 * Runs a single golden vector against tax-core and returns the reconciliation
 * result with per-field diffs.
 */
export function reconcileVector(vector: MtrGoldenVector): MtrReconciliationResult {
  const config = getConfig(vector.taxYear);
  const calc = computeFullReturn(vector.input, config);
  const diffs: MtrReconciliationDiff[] = [];

  for (const expected of vector.expected) {
    const actual = extractActualValue(calc, expected.box);

    if (actual === undefined) {
      diffs.push({
        box: expected.box,
        expectedPence: expected.expectedPence,
        actualPence: -1,
        diffPence: expected.expectedPence + 1,
        methodologyRef: `${expected.methodologyRef} [FIELD NOT FOUND IN COMPUTATION]`,
      });
      continue;
    }

    if (actual !== expected.expectedPence) {
      diffs.push({
        box: expected.box,
        expectedPence: expected.expectedPence,
        actualPence: actual,
        diffPence: Math.abs(actual - expected.expectedPence),
        methodologyRef: expected.methodologyRef,
      });
    }
  }

  return {
    vectorName: vector.name,
    taxYear: vector.taxYear,
    passed: diffs.length === 0,
    diffs,
  };
}

/**
 * Self-test: verifies that a deliberately corrupted constant makes the harness
 * fail. If this self-test passes, it proves the harness is not vacuously true.
 *
 * Corruption method: temporarily mutate the personal allowance in the config,
 * run a known vector, check for failure, then restore.
 */
function runSelfTest(): boolean {
  const config = getConfig('2025-26');
  const originalPA = config.personalAllowance;

  // Corrupt the PA by £1
  (config as any).personalAllowance = originalPA + 100;

  try {
    // Use V1 (salary £85k) — PA affects taxable income and total tax
    const v1 = MTR_GOLDEN_VECTORS.find(v => v.name.startsWith('V1:'));
    if (!v1) return false;

    const result = reconcileVector(v1);
    // The harness SHOULD fail because PA is wrong
    return !result.passed;
  } finally {
    // Restore the original value
    (config as any).personalAllowance = originalPA;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Runs the full MTR reconciliation suite: all golden vectors + the self-test.
 * Returns a comprehensive report.
 */
export function runMtrReconciliationSuite(
  vectors: MtrGoldenVector[] = MTR_GOLDEN_VECTORS
): MtrHarnessReport {
  const results = vectors.map(reconcileVector);
  const selfTestPassed = runSelfTest();

  return {
    totalVectors: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
    selfTestPassed,
  };
}
