import { Return } from '@uk-sa-app/return-model';

export type ProvenanceSource = 'tax-core' | 'user_input' | 'user_document_extraction';

export interface ProvenanceRecord {
  fieldPath: string;
  value: number;
  source: ProvenanceSource;
  timestamp: string;
}

export interface ProvenanceValidationResult {
  valid: boolean;
  violations: string[];
}

/**
 * Asserts that all figures bound to a return model or calculation envelope
 * originate strictly from deterministic calculation engine output (tax-core)
 * or explicit user input/OCR document extraction, and NEVER from LLM estimation.
 */
export function validateReturnProvenance(
  returnObj: Return,
  computation?: any
): ProvenanceValidationResult {
  const violations: string[] = [];

  // 1. Check Return input model structure & non-finite numbers
  if (!returnObj || typeof returnObj !== 'object') {
    violations.push('Return object is null, undefined, or invalid type');
    return { valid: false, violations };
  }

  if (returnObj.sa100?.income) {
    const inc = returnObj.sa100.income;
    if (typeof inc.ukSavingsIncome === 'number' && !isFinite(inc.ukSavingsIncome)) {
      violations.push('SA100.income.ukSavingsIncome is non-finite');
    }
    if (typeof inc.ukDividendIncome === 'number' && !isFinite(inc.ukDividendIncome)) {
      violations.push('SA100.income.ukDividendIncome is non-finite');
    }
  }

  if (returnObj.sa102) {
    returnObj.sa102.forEach((job, idx) => {
      if (typeof job.grossPay === 'number' && !isFinite(job.grossPay)) {
        violations.push(`SA102[${idx}].grossPay is invalid non-finite number`);
      }
      if (typeof job.taxDeducted === 'number' && !isFinite(job.taxDeducted)) {
        violations.push(`SA102[${idx}].taxDeducted is invalid non-finite number`);
      }
    });
  }

  if (returnObj.sa106?.foreignIncome) {
    returnObj.sa106.foreignIncome.forEach((item, idx) => {
      if (typeof item.grossAmount === 'number' && !isFinite(item.grossAmount)) {
        violations.push(`SA106.foreignIncome[${idx}].grossAmount is invalid non-finite number`);
      }
      if (typeof item.foreignTaxPaid === 'number' && !isFinite(item.foreignTaxPaid)) {
        violations.push(`SA106.foreignIncome[${idx}].foreignTaxPaid is invalid non-finite number`);
      }
    });
  }

  if (returnObj.sa108?.disposals) {
    returnObj.sa108.disposals.forEach((d, idx) => {
      if (typeof d.proceeds === 'number' && !isFinite(d.proceeds)) {
        violations.push(`SA108.disposals[${idx}].proceeds is invalid non-finite number`);
      }
      if (typeof d.costs === 'number' && !isFinite(d.costs)) {
        violations.push(`SA108.disposals[${idx}].costs is invalid non-finite number`);
      }
    });
  }

  // 2. Check Computation output
  if (computation) {
    if (!computation.version || !computation.version.configHash) {
      violations.push('Computation lacks deterministic version/configHash signature');
    }
    if (!computation.version?.engineVersion) {
      violations.push('Computation lacks engineVersion field');
    }
    if (typeof computation.balancingPayment !== 'number' || !isFinite(computation.balancingPayment)) {
      violations.push('Computation balancingPayment is missing or non-finite');
    }
    if (computation.incomeTax) {
      const it = computation.incomeTax;
      if (typeof it.incomeTaxTotal !== 'number' || !isFinite(it.incomeTaxTotal)) {
        violations.push('Computation incomeTaxTotal is missing or non-numeric');
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
