import { enforceFigureGuardrail } from './services/guardrail.js';
import { validateReturnProvenance } from './services/provenance-guard.js';
import { Return } from '@uk-sa-app/return-model';
import { getConfig } from '@uk-sa-app/tax-config';
import { computeFullReturn } from '@uk-sa-app/tax-core';

function runSafetyNetTests() {
  console.log('Starting Safety Net Live Path Unit Tests (C5)...');

  const config = getConfig('2025-26');
  const returnObj: Return = {
    id: 'safety-test-1',
    clientId: 'client-safety',
    taxYear: '2025-26',
    status: 'draft',
    sa100: { taxAlreadyPaid: { payeTax: 2012300, taxDeductedFromSavings: 0, taxDeductedFromDividends: 0, cisDeductions: 0, otherTaxPaid: 0 }, reliefs: { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false } },
    sa102: [{ employerName: 'Acme UK Ltd', grossPay: 8500000, taxDeducted: 2012300, benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 }, expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 } }],
    updatedAt: new Date().toISOString(),
  };

  const computation = computeFullReturn(returnObj, config);

  // 1. Test Redaction of unverified £ figure
  const hallucinatedReply = 'Your calculated balancing payment is £9,999.99 based on your employment income.';
  const guarded = enforceFigureGuardrail(hallucinatedReply, computation, returnObj, config);

  console.log(`Input hallucinated reply: "${hallucinatedReply}"`);
  console.log(`Guarded reply output: "${guarded.text}"`);

  if (!guarded.redacted || guarded.text.includes('£9,999.99')) {
    console.error('✗ Failure: Unverified £9,999.99 figure was NOT redacted by live path safety net!');
    process.exit(1);
  }
  console.log('✓ Success: Unverified £9,999.99 figure was successfully redacted from model reply before leaving server.');

  // 2. Test Provenance Validation
  const validProvenance = validateReturnProvenance(returnObj, computation);
  if (!validProvenance.valid) {
    console.error('✗ Failure: Valid deterministic calculation failed provenance check!');
    process.exit(1);
  }
  console.log('✓ Success: Valid calculation passed provenance verification.');

  // 3. Test Non-provenanced / corrupted calculation blocking
  const corruptedComputation = { ...computation, version: null };
  const invalidProvenance = validateReturnProvenance(returnObj, corruptedComputation);
  if (invalidProvenance.valid) {
    console.error('✗ Failure: Calculation lacking version/configHash signature passed provenance check!');
    process.exit(1);
  }
  console.log('✓ Success: Calculation lacking deterministic provenance signature was successfully blocked.');

  console.log('✅ All Safety Net Live Path Unit Tests (C5) passed successfully!');
}

runSafetyNetTests();
