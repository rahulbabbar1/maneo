import { checkIndividualExclusions } from './exclusions-mapping.js';
import { Return } from '@uk-sa-app/return-model';

function runExclusionsTests() {
  console.log('Starting Individual Exclusions Unit Tests...');

  // Test Case 1: Normal return (no exclusions)
  const normalReturn: Return = {
    id: 'test-1',
    clientId: 'client-1',
    taxYear: '2024-25',
    status: 'draft',
    sa100: { taxAlreadyPaid: { payeTax: 0, taxDeductedFromSavings: 0, taxDeductedFromDividends: 0, cisDeductions: 0, otherTaxPaid: 0 }, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false } },
    sa102: [{ employerName: 'Acme Ltd', grossPay: 5000000, taxDeducted: 1000000, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
    updatedAt: new Date().toISOString(),
  };

  const report1 = checkIndividualExclusions(normalReturn);
  if (report1.refusalRequired) {
    console.error('✗ Failure: Normal return flagged for paper refusal!');
    process.exit(1);
  }
  console.log('✓ Success: Normal return allowed online.');

  // Test Case 2: Excess schedules (>50 jobs)
  const excessJobsReturn: Return = {
    ...normalReturn,
    sa102: Array(51).fill({ employerName: 'Job', grossPay: 1000, taxDeducted: 0, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }),
  };

  const report2 = checkIndividualExclusions(excessJobsReturn);
  if (!report2.refusalRequired || !report2.exclusions.some(e => e.exclusionId === 15)) {
    console.error('✗ Failure: Excess schedules return not flagged for exclusion #15 refusal!');
    process.exit(1);
  }
  console.log('✓ Success: Exclusion #15 correctly triggered paper refusal.');

  // Test Case 3: Employer with no PAYE reference (Special Case #14)
  const noRefReturn: Return = {
    ...normalReturn,
    sa102: [{ employerName: 'NoRef Corp', employerRef: 'NONE', grossPay: 5000000, taxDeducted: 1000000, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
  };

  const report3 = checkIndividualExclusions(noRefReturn);
  if (report3.refusalRequired || !report3.exclusions.some(e => e.exclusionId === 14)) {
    console.error('✗ Failure: Special Case #14 workaround not identified!');
    process.exit(1);
  }
  console.log('✓ Success: Special Case #14 workaround identified without refusing paper.');

  console.log('✅ All Exclusions Unit Tests passed successfully!');
}

runExclusionsTests();
