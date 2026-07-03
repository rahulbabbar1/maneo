import { computeIncomeTax, computeFullReturn } from '@uk-sa-app/tax-core';
import { Return } from '@uk-sa-app/return-model';
import { getConfig } from '@uk-sa-app/tax-config';

function runMcpCalculationTests() {
  console.log('Starting MCP Calculation Tests...');

  // Test case 1: Standard income tax calculation
  const input1 = {
    taxYear: '2025-26',
    region: 'rUK' as const,
    nonSavingsIncome: 4500000, // £45,000
    savingsIncome: 100000,     // £1,000
    dividendIncome: 200000,    // £2,000
    giftAidGrossedUp: 0,
    relievablePensionContributions: 0,
    blindPersonsAllowanceClaimed: false,
  };

  const config = getConfig(input1.taxYear);
  const result1 = computeIncomeTax(input1, config);

  console.log(`- Personal Allowance: £${(result1.personalAllowance / 100).toFixed(2)}`);
  console.log(`- Total Income Tax: £${(result1.incomeTaxTotal / 100).toFixed(2)}`);

  // Assertions for standard tax calculations
  if (result1.personalAllowance !== 1257000) {
    console.error('✗ Failure: Personal allowance is incorrect!');
    process.exit(1);
  }

  // Test case 2: Full Return calculation
  const mockReturn: Return = {
    id: 'a3f2130f-dd1d-44b0-a5d6-c55b099b8fdb',
    clientId: 'client-mcp-test',
    taxYear: '2025-26',
    status: 'draft',
    sa100: {
      taxAlreadyPaid: {
        payeTax: 650000, // £6,500
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
        grossPay: 4500000,
        taxDeducted: 650000,
        benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
        expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  const result2 = computeFullReturn(mockReturn, config);
  console.log(`- Balancing Payment: £${(result2.balancingPayment / 100).toFixed(2)}`);

  if (result2.balancingPayment === undefined || isNaN(result2.balancingPayment)) {
    console.error('✗ Failure: Full return calculation returned NaN!');
    process.exit(1);
  }

  console.log('✓ All MCP Calculation Tests passed successfully!');
}

runMcpCalculationTests();
