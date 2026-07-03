import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';

// Helper to extract numbers from text
function extractMonetaryAmounts(text: string): number[] {
  const matches = text.match(/(?:£\s*)?(\d+(?:,\d{3})*(?:\.\d{2})?)/g) || [];
  return matches.map(m => {
    const clean = m.replace(/[£,]/g, '').trim();
    return parseFloat(clean);
  });
}

function runGuardrailTest() {
  console.log('Starting AI Chat Guardrail Verification Tests...');

  // 1. Setup sample return (2025-26)
  const mockReturn: Return = {
    id: 'a3f2130f-dd1d-44b0-a5d6-c55b099b8fdb',
    clientId: 'client-1',
    taxYear: '2025-26',
    status: 'draft',
    sa100: {
      taxAlreadyPaid: {
        payeTax: 0,
        taxDeductedFromSavings: 0,
        taxDeductedFromDividends: 0,
        cisDeductions: 0,
        otherTaxPaid: 0,
      },
      reliefs: {
        giftAidGrossedUp: 0,
        relievablePensionContributions: 0,
        blindPersonsAllowance: false,
        marriageAllowanceTransferor: false,
        marriageAllowanceRecipient: false,
      },
    },
    sa102: [
      {
        employerName: 'Global Corp',
        grossPay: 8500000, // £85,000 in pence
        taxDeducted: 2012300,
        benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
        expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  const config = getConfig('2025-26');
  const computation = computeFullReturn(mockReturn, config);

  // Valid calculations (in pounds)
  const validAmounts: Set<number> = new Set();
  validAmounts.add(computation.balancingPayment / 100); // 21,825.75
  validAmounts.add(computation.incomeTax.incomeTaxTotal / 100);
  validAmounts.add(computation.incomeTax.personalAllowance / 100);
  computation.incomeTax.allocatedBands.forEach(b => {
    validAmounts.add(b.amountAllocated / 100);
    validAmounts.add(b.taxCharged / 100);
  });

  console.log(`  - Valid tax liability: £${computation.incomeTax.incomeTaxTotal / 100}`);

  // Test Case A: Valid LLM response quoting correct numbers
  const personalAllowanceStr = (computation.incomeTax.personalAllowance / 100).toFixed(2);
  const totalTaxStr = (computation.incomeTax.incomeTaxTotal / 100).toFixed(2);
  let validLLMResponse = `Your personal allowance is £${personalAllowanceStr} and your total tax due is £${totalTaxStr}. Let me know if that is correct.`;
  console.log(`\nCase A Input: "${validLLMResponse}"`);
  
  const amountsA = extractMonetaryAmounts(validLLMResponse);
  console.log('amountsA:', amountsA);
  console.log('validAmounts:', Array.from(validAmounts));
  let cleanA = true;
  for (const amt of amountsA) {
    if (amt > 100 && !validAmounts.has(amt)) {
      cleanA = false;
    }
  }
  if (!cleanA) {
    console.error('✗ Failure: Guardrail flagged a correct calculation amount!');
    process.exit(1);
  }
  console.log('✓ Success: Guardrail allowed correct figures.');

  // Test Case B: Hallucinated LLM response (invented numbers)
  let hallucinatedLLMResponse = `Based on my knowledge, your tax liability should be £95,432.50.`;
  console.log(`\nCase B Input: "${hallucinatedLLMResponse}"`);

  let scrubbedResponse = hallucinatedLLMResponse;
  const matchesB = hallucinatedLLMResponse.match(/(?:£\s*)?(\d+(?:,\d{3})*(?:\.\d{2})?)/g) || [];
  let flagged = false;
  for (const m of matchesB) {
    const clean = m.replace(/[£,]/g, '').trim();
    const amt = parseFloat(clean);
    if (amt > 100 && !validAmounts.has(amt)) {
      flagged = true;
      scrubbedResponse = scrubbedResponse.replace(m, '[REDACTED_UNVERIFIED_FIGURE]');
    }
  }

  console.log(`Result: "${scrubbedResponse}"`);

  if (!flagged) {
    console.error('✗ Failure: Guardrail did not flag hallucinated figure!');
    process.exit(1);
  }
  if (!scrubbedResponse.includes('[REDACTED_UNVERIFIED_FIGURE]')) {
    console.error('✗ Failure: Hallucinated figure was not redacted!');
    process.exit(1);
  }

  console.log('✓ Success: Guardrail successfully blocked and redacted hallucinated figure.');
  console.log('\nAll Guardrail Verification Tests passed successfully!');
}

runGuardrailTest();
