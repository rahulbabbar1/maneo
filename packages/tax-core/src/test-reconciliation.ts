import { reconcileReturnAgainstMethodology } from './reconciliation-harness.js';
import { Return } from '@uk-sa-app/return-model';

function runReconciliationTests() {
  console.log('Starting Tax-Core Methodology Reconciliation Tests...');

  const mockReturn: Return = {
    id: 'recon-test-1',
    clientId: 'client-recon',
    taxYear: '2024-25',
    status: 'draft',
    sa100: { taxAlreadyPaid: { payeTax: 0, taxDeductedFromSavings: 0, taxDeductedFromDividends: 0, cisDeductions: 0, otherTaxPaid: 0 }, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false } },
    sa102: [{ employerName: 'Acme Corp UK', grossPay: 8500000, taxDeducted: 2012300, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
    updatedAt: new Date().toISOString(),
  };

  const report = reconcileReturnAgainstMethodology(mockReturn, 'Standard Salary Archetype');
  console.log(`Reconciliation Result: ${report.passed ? 'ZERO-DIFF PASS' : 'DIFF DETECTED'}`);
  console.log(`Authority: ${report.sourceAuthority}`);

  if (!report.passed) {
    console.error('✗ Failure: Reconciliation diff detected against methodology spec!');
    console.error(report.diffs);
    process.exit(1);
  }

  console.log('✓ Success: Zero-diff match against HMRC Calculate Tax & NIC methodology v2.4.1a!');
  console.log('✅ All Reconciliation Tests passed successfully!');
}

runReconciliationTests();
