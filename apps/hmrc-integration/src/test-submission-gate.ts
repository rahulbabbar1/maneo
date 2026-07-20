import { evaluateSubmissionGate } from './services/submission-gate.js';
import { Return } from '@uk-sa-app/return-model';

async function runSubmissionGateTests() {
  console.log('Starting SubmissionGate 4-Part Pre-Filing Checkpoint Tests...');

  // 1. Setup valid archetype return
  const validReturn: Return = {
    id: 'gate-test-1',
    clientId: 'client-gate',
    taxYear: '2025-26',
    status: 'draft',
    sa100: { taxAlreadyPaid: { payeTax: 2012300, taxDeductedFromSavings: 0, taxDeductedFromDividends: 0, cisDeductions: 0, otherTaxPaid: 0 }, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false } },
    sa102: [{ employerName: 'Acme UK Ltd', employerRef: '120/A4590', grossPay: 8500000, taxDeducted: 2012300, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
    sa109: { residenceStatus: { daysInUk: 190, srtResult: 'resident', domicileStatus: 'foreign_domiciled', figRegimeElected: true, overseasWorkdayReliefClaimed: false } },
    updatedAt: new Date().toISOString(),
  };

  const gateResult = await evaluateSubmissionGate(validReturn);

  console.log(`\nSubmissionGate Status: ${gateResult.canSubmitOnline ? 'CAN SUBMIT ONLINE' : 'SUBMISSION BLOCKED'}`);
  gateResult.parts.forEach(p => console.log(`  - [${p.passed ? 'PASS' : 'FAIL'}] ${p.partName}: ${p.details}`));

  if (!gateResult.canSubmitOnline) {
    console.error('✗ Failure: Valid archetype return was blocked by SubmissionGate!');
    process.exit(1);
  }

  // 2. Setup excluded return (51 jobs)
  const excludedReturn: Return = {
    ...validReturn,
    sa102: Array(51).fill({ employerName: 'Job', grossPay: 1000, taxDeducted: 0, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }),
  };

  const excludedResult = await evaluateSubmissionGate(excludedReturn);
  if (excludedResult.canSubmitOnline || !excludedResult.refusalReason?.includes('Exclusion #15')) {
    console.error('✗ Failure: Excluded return was NOT blocked by SubmissionGate Part 4!');
    process.exit(1);
  }

  console.log('\n✓ Success: SubmissionGate correctly blocked excluded return with paper guidance.');
  console.log(`Guidance: "${excludedResult.paperGuidance}"`);
  console.log('✅ All SubmissionGate 4-Part Tests passed successfully!');
}

runSubmissionGateTests();
