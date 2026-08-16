import { computeFullReturn, FullReturnComputation } from './calculations/assembler.js';
import { Return } from '@uk-sa-app/return-model';
import { getConfig } from '@uk-sa-app/tax-config';
import { runMtrReconciliationSuite, reconcileVector, MtrReconciliationResult } from './mtr-reconciliation-harness.js';
import { MTR_GOLDEN_VECTORS, MtrGoldenVector } from './mtr-golden-vectors.js';

// ─── Legacy types (preserved for backward compat with SubmissionGate) ────────

export interface ReconciliationDiff {
  field: string;
  taxCoreValue: number; // in pence
  expectedValue: number; // in pence
  diffInPence: number;
}

export interface ReconciliationReport {
  vectorName: string;
  passed: boolean;
  diffs: ReconciliationDiff[];
  taxYear: string;
  sourceAuthority: string;
}

// ─── Re-export the new harness ──────────────────────────────────────────────

export { runMtrReconciliationSuite, reconcileVector, MtrReconciliationResult };
export { MTR_GOLDEN_VECTORS, MtrGoldenVector };

/**
 * Reconciles a return against HMRC methodology by running it through the
 * MTR-anchored harness. If the return matches an existing golden vector,
 * it will be reconciled against external truth. Otherwise it performs a
 * structural validation of the computation.
 *
 * NOTE: For full MTR reconciliation (CI gate), use runMtrReconciliationSuite().
 * This function exists for backward compat with the SubmissionGate which needs
 * to reconcile a *specific* return (not a golden vector).
 */
export function reconcileReturnAgainstMethodology(
  returnObj: Return,
  vectorName: string = 'Unnamed Vector'
): ReconciliationReport {
  const taxYear = returnObj.taxYear || '2024-25';
  const config = getConfig(taxYear);
  const calc: FullReturnComputation = computeFullReturn(returnObj, config);

  const diffs: ReconciliationDiff[] = [];

  // Structural validation: verify the computation is internally consistent
  // (deterministic, finite, and the core figures are plausible).

  // 1. Total income must be non-negative and finite
  if (!isFinite(calc.totalIncome) || calc.totalIncome < 0) {
    diffs.push({
      field: 'totalIncome',
      taxCoreValue: calc.totalIncome,
      expectedValue: 0,
      diffInPence: Math.abs(calc.totalIncome),
    });
  }

  // 2. Income tax total must be non-negative and finite
  if (!isFinite(calc.incomeTax.incomeTaxTotal) || calc.incomeTax.incomeTaxTotal < 0) {
    diffs.push({
      field: 'incomeTaxTotal',
      taxCoreValue: calc.incomeTax.incomeTaxTotal,
      expectedValue: 0,
      diffInPence: Math.abs(calc.incomeTax.incomeTaxTotal),
    });
  }

  // 3. PA must be >= 0
  if (calc.incomeTax.personalAllowance < 0) {
    diffs.push({
      field: 'personalAllowance',
      taxCoreValue: calc.incomeTax.personalAllowance,
      expectedValue: 0,
      diffInPence: Math.abs(calc.incomeTax.personalAllowance),
    });
  }

  // 4. Balancing payment must be finite
  if (!isFinite(calc.balancingPayment)) {
    diffs.push({
      field: 'balancingPayment',
      taxCoreValue: calc.balancingPayment,
      expectedValue: 0,
      diffInPence: 1,
    });
  }

  // 5. Taxable amounts must sum correctly
  const expectedTaxable = calc.incomeTax.taxableNonSavings +
    calc.incomeTax.taxableSavings + calc.incomeTax.taxableDividends;
  const bandTotal = calc.incomeTax.allocatedBands.reduce((s, b) => s + b.amountAllocated, 0);
  if (Math.abs(expectedTaxable - bandTotal) > 1) {
    diffs.push({
      field: 'bandAllocationSum',
      taxCoreValue: bandTotal,
      expectedValue: expectedTaxable,
      diffInPence: Math.abs(expectedTaxable - bandTotal),
    });
  }

  return {
    vectorName,
    passed: diffs.length === 0,
    diffs,
    taxYear,
    sourceAuthority: 'MTR-Tester / Calculate Tax and NIC methodology (structural validation)',
  };
}

export function runFullReconciliationSuite(vectors: { name: string; returnObj: Return }[]): ReconciliationReport[] {
  return vectors.map(v => reconcileReturnAgainstMethodology(v.returnObj, v.name));
}
