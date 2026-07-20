import { Return } from '@uk-sa-app/return-model';

export interface ExclusionCheckResult {
  exclusionId: number;
  category: 'Category 1 (System Exclusion)' | 'Category 2 (Special Case)';
  schedule: string;
  issue: string;
  action: 'refuse_to_paper' | 'allow_with_workaround';
  workaround?: string;
  reason: string;
}

export interface ExclusionsReport {
  excluded: boolean;
  refusalRequired: boolean;
  exclusions: ExclusionCheckResult[];
}

/**
 * Evaluates a Return against HMRC 2024-25 Category 1 & 2 Individual Exclusions
 * affecting SA100, SA102, and SA109 returns.
 */
export function checkIndividualExclusions(returnObj: Return): ExclusionsReport {
  const results: ExclusionCheckResult[] = [];

  // Exclusion #15 / Special Case #5: Excess schedule counts
  if (returnObj.sa102 && returnObj.sa102.length > 50) {
    results.push({
      exclusionId: 15,
      category: 'Category 1 (System Exclusion)',
      schedule: 'SA102',
      issue: 'Number of employment schedules exceeds schema limit (50).',
      action: 'refuse_to_paper',
      reason: 'HMRC online rail allows a maximum of 50 employment schedules (SA102). Must paper file.',
    });
  }

  // Exclusion #47: Section 811 ITA 2007 disregarded income claim (SA109 non-resident)
  if (returnObj.sa109?.residenceStatus?.srtResult === 'non_resident') {
    const isDisregardedClaim = (returnObj.sa109 as any)?.disregardedIncomeClaim === true;
    if (isDisregardedClaim) {
      results.push({
        exclusionId: 47,
        category: 'Category 1 (System Exclusion)',
        schedule: 'SA109',
        issue: 'Disregarded income claim under s811 ITA 2007 is not supported by legacy calculation engine.',
        action: 'refuse_to_paper',
        reason: 's811 ITA 2007 disregarded income claims for non-residents require paper calculation & filing.',
      });
    }
  }

  // Exclusion #135: Dual or non-UK resident partial relief under Double Taxation Agreements
  if (returnObj.sa109 && (returnObj.sa109 as any)?.dtaPartialReliefClaim === true) {
    results.push({
      exclusionId: 135,
      category: 'Category 1 (System Exclusion)',
      schedule: 'SA109',
      issue: 'Partial relief claim under Double Taxation Agreements (DTA) by dual/non-residents.',
      action: 'refuse_to_paper',
      reason: 'Partial DTA relief claims on SA109 must be submitted on paper.',
    });
  }

  // Special Case #11: SA102 complete when no UK liability arises for SA109 non-resident
  if (returnObj.sa109?.residenceStatus?.srtResult === 'non_resident' && returnObj.sa102 && returnObj.sa102.length > 0) {
    const nonUkWorkOnly = returnObj.sa102.every((emp: any) => emp.nonUkWorkOnly === true);
    if (nonUkWorkOnly) {
      results.push({
        exclusionId: 11,
        category: 'Category 2 (Special Case)',
        schedule: 'SA109 / SA102',
        issue: 'No UK tax liability arises on employment income for non-resident.',
        action: 'allow_with_workaround',
        workaround: 'Do not complete SA102 employment page; tick Yes to question 1 on SA109 page 2.',
        reason: 'HMRC Special Case #11 requires omitting SA102 and checking SA109 Box 1.',
      });
    }
  }

  // Special Case #14: Employer with no PAYE reference
  if (returnObj.sa102) {
    for (const emp of returnObj.sa102) {
      if (!emp.employerRef || emp.employerRef.trim() === '' || emp.employerRef.toUpperCase() === 'NONE' || emp.employerRef.toUpperCase() === 'N/A') {
        results.push({
          exclusionId: 14,
          category: 'Category 2 (Special Case)',
          schedule: 'SA102',
          issue: 'Employer has no PAYE reference number.',
          action: 'allow_with_workaround',
          workaround: 'Enter 000/N in employer reference field.',
          reason: 'HMRC Special Case #14 requires entering "000/N" for employers without a PAYE reference.',
        });
      }
    }
  }

  // Special Case #30: Remittance basis charge with nominated income
  if (returnObj.sa106?.remittanceBasis?.claimRemittanceBasis && (returnObj.sa106?.remittanceBasis as any)?.remittanceChargePaid > 0) {
    const hasNominatedIncome = (returnObj.sa106?.remittanceBasis as any)?.nominatedIncomePresent === true;
    if (hasNominatedIncome) {
      results.push({
        exclusionId: 30,
        category: 'Category 2 (Special Case)',
        schedule: 'SA109',
        issue: 'Remittance basis charge with nominated income + taxable income interaction.',
        action: 'refuse_to_paper',
        reason: 'Remittance basis charge with nominated income cannot be computed accurately online by HMRC system. Must file on paper.',
      });
    }
  }

  const refusalRequired = results.some(r => r.action === 'refuse_to_paper');

  return {
    excluded: results.length > 0,
    refusalRequired,
    exclusions: results,
  };
}
