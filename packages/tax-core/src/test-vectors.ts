import { computeFullReturn, FullReturnComputation } from './calculations/assembler.js';
import { Return } from '@uk-sa-app/return-model';
import { CONFIG_2025_26 } from '@uk-sa-app/tax-config';

interface GoldenVector {
  name: string;
  returnObj: Return;
  assertions: (result: FullReturnComputation) => void;
}

function assertEq(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

// Reusable empty SA100 sub-objects to satisfy the schema-inferred types.
const emptyTaxPaid = {
  payeTax: 0,
  taxDeductedFromSavings: 0,
  taxDeductedFromDividends: 0,
  cisDeductions: 0,
  otherTaxPaid: 0,
};
const emptyReliefs = {
  giftAidGrossedUp: 0,
  relievablePensionContributions: 0,
  blindPersonsAllowance: false,
  marriageAllowanceTransferor: false,
  marriageAllowanceRecipient: false,
};
const emptyBenefits = { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 };
const emptyExpenses = { businessTravel: 0, professionalFees: 0, otherExpenses: 0 };

const GOLDEN_VECTORS: GoldenVector[] = [
  {
    name: 'Case 1: Salary only £85,000 (2025-26, rUK)',
    returnObj: {
      id: '11111111-1111-4111-8111-111111111111',
      clientId: 'client-1',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Acme Corp UK', grossPay: 8500000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('personalAllowance', r.incomeTax.personalAllowance, 1257000);
      // basic 37,700@20% = 7,540 + higher (72,430-37,700)@40% = 13,892 => £21,432
      assertEq('incomeTaxTotal', r.incomeTax.incomeTaxTotal, 2143200);
      assertEq('balancingPayment', r.balancingPayment, 2143200);
    },
  },
  {
    name: 'Case 2: Band stacking — £60,000 salary + £3,000 UK savings (catches H1)',
    returnObj: {
      id: '22222222-2222-4222-8222-222222222222',
      clientId: 'client-2',
      taxYear: '2025-26',
      status: 'draft',
      sa100: {
        income: { ukSavingsIncome: 300000, ukDividendIncome: 0 },
        taxAlreadyPaid: emptyTaxPaid,
        reliefs: emptyReliefs,
      },
      sa102: [{ employerName: 'Global Corp UK', grossPay: 6000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // nonSavings tax £11,432; savings: £500 PSA @0%, remaining £2,500 @40% = £1,000 => £12,432
      assertEq('incomeTaxTotal', r.incomeTax.incomeTaxTotal, 1243200);
      const savingsAtHigher = r.incomeTax.allocatedBands.some(b => b.category === 'savings' && b.rate === 0.40 && b.taxCharged > 0);
      if (!savingsAtHigher) throw new Error('Savings income was not stacked into the higher-rate band (H1 regression)');
    },
  },
  {
    name: 'Case 3: Residence trusts SA109 (catches H3) — 170 days, declared resident',
    returnObj: {
      id: '33333333-3333-4333-8333-333333333333',
      clientId: 'client-3',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Overseas Bank UK', grossPay: 5000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa109: {
        residenceStatus: {
          daysInUk: 170,
          srtResult: 'resident',
          domicileStatus: 'foreign_domiciled',
          figRegimeElected: false,
          overseasWorkdayReliefClaimed: false,
        },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      if (r.residenceStatus !== 'UK Resident') {
        throw new Error(`Expected UK Resident (trusting SA109), got "${r.residenceStatus}"`);
      }
    },
  },
  {
    name: 'Case 4: HICBC divisor £200 (catches H5) — £70,000 income, £2,000 child benefit',
    returnObj: {
      id: '44444444-4444-4444-8444-444444444444',
      clientId: 'client-4',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Corp UK', grossPay: 7000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa101: {
        highIncomeChildBenefitCharge: { incomeOverThreshold: true, numberOfChildren: 1, benefitAmountReceived: 200000 },
        studentLoan: { planType: 'none' },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // (70,000 - 60,000) / 200 = 50% ; 50% of £2,000 = £1,000
      assertEq('hicbcPercentage x100', Math.round(r.charges.hicbcPercentage * 100), 50);
      assertEq('hicbcAmount', r.charges.hicbcAmount, 100000);
    },
  },
  {
    name: 'Case 5: Foreign dividends + FTCR (India 15% cap)',
    returnObj: {
      id: '55555555-5555-4555-8555-555555555555',
      clientId: 'client-5',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Acme Corp UK', grossPay: 8500000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa106: {
        foreignIncome: [{ countryCode: 'IND', incomeType: 'dividends', grossAmount: 500000, foreignTaxPaid: 75000, claimFtcr: true }],
        remittanceBasis: { claimRemittanceBasis: false, remittedAmount: 0, remittanceChargePaid: 0 },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('personalAllowance', r.incomeTax.personalAllowance, 1257000);
      // relievable = min(£750 paid, 15% of £5,000 = £750) = £750; capped at UK tax on the source (> £750)
      assertEq('ftcr allowedCredit', r.ftcr?.totalAllowedCredit || 0, 75000);
    },
  },
  {
    name: 'Case 6: Personal allowance fully tapered at £140,000',
    returnObj: {
      id: '66666666-6666-4666-8666-666666666666',
      clientId: 'client-6',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Global Corp UK', grossPay: 14000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('personalAllowance', r.incomeTax.personalAllowance, 0);
    },
  },
];

function runTests() {
  console.log('Starting Golden-Vector Test Suite...');
  let failed = false;

  for (const vector of GOLDEN_VECTORS) {
    console.log(`\nRunning vector: "${vector.name}"`);
    try {
      const result = computeFullReturn(vector.returnObj, CONFIG_2025_26);
      vector.assertions(result);
      console.log('  ✓ Success');
    } catch (error: any) {
      console.error('  ✗ Failure:', error.message || error);
      failed = true;
    }
  }

  if (failed) {
    console.error('\nGolden-Vector Test Suite failed!');
    process.exit(1);
  } else {
    console.log('\nAll Golden-Vector Test Cases passed successfully!');
  }
}

runTests();
