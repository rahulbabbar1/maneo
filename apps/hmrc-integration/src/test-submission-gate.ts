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
    clientDetails: {
      utr: '1234567890',
    },
    sa100: { taxAlreadyPaid: { payeTax: 2012300, taxDeductedFromSavings: 0, taxDeductedFromDividends: 0, cisDeductions: 0, otherTaxPaid: 0 }, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false } },
    sa102: [{ employerName: 'Acme UK Ltd', employerRef: '120/A4590', grossPay: 8500000, taxDeducted: 2012300, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
    sa108: { disposals: [{ assetType: 'listed_shares', disposalDate: '2025-09-10', proceeds: 2000000, costs: 1000000, losses: 0, claimBadr: false }], broughtForwardLosses: 0 },
    sa101: { highIncomeChildBenefitCharge: { incomeOverThreshold: false, numberOfChildren: 0, benefitAmountReceived: 0 }, studentLoan: { planType: 'plan_1' } },
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

  // 3. Setup invalid return (missing tax year / provenance failure)
  const invalidReturn: Return = {
    ...validReturn,
    id: '',
    taxYear: '',
  };
  const invalidResult = await evaluateSubmissionGate(invalidReturn);
  if (invalidResult.canSubmitOnline || invalidResult.parts[0].passed) {
    console.error('✗ Failure: Return lacking valid ID/taxYear was NOT blocked by SubmissionGate Part 1!');
    process.exit(1);
  }
  console.log('✓ Success: SubmissionGate Part 1 correctly blocked return lacking provenance/taxYear.');

  // 4. Setup invalid tax year return (unsupported taxYear / configHash mismatch)
  const unconfiguredReturn: Return = {
    ...validReturn,
    taxYear: '1999-00',
  };
  const unconfiguredResult = await evaluateSubmissionGate(unconfiguredReturn);
  if (unconfiguredResult.canSubmitOnline || unconfiguredResult.parts[0].passed) {
    console.error('✗ Failure: Return with invalid tax year was NOT blocked by SubmissionGate Part 1!');
    process.exit(1);
  }
  console.log('✓ Success: SubmissionGate Part 1 correctly blocked unconfigured tax year.');

  console.log('\n✅ All SubmissionGate 4-Part Tests passed successfully!');
}

runSubmissionGateTests();
