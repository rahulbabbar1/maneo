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
  {
    name: 'Case 7: Gift Aid grossed-up band extension (£5,000)',
    returnObj: {
      id: '77777777-7777-4777-8777-777777777777',
      clientId: 'client-7',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: { ...emptyReliefs, giftAidGrossedUp: 500000 } },
      sa102: [{ employerName: 'Acme UK', grossPay: 6000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // Basic rate band extended from £37,700 to £42,700 (£37,700 + £5,000)
      const basicBand = r.incomeTax.allocatedBands.find(b => b.name === 'basic');
      assertEq('basic rate band allocation', basicBand?.amountAllocated || 0, 4270000);
    },
  },
  {
    name: 'Case 8: Pension contribution relievable band extension (£10,000)',
    returnObj: {
      id: '88888888-8888-4888-8888-888888888888',
      clientId: 'client-8',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: { ...emptyReliefs, relievablePensionContributions: 1000000 } },
      sa102: [{ employerName: 'TechCorp UK', grossPay: 6500000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // Basic rate band extended by £10,000 to £47,700
      const basicBand = r.incomeTax.allocatedBands.find(b => b.name === 'basic');
      assertEq('basic rate band allocation', basicBand?.amountAllocated || 0, 4770000);
    },
  },
  {
    name: 'Case 9: Student Loan Plan 1 charge (£50,000 salary)',
    returnObj: {
      id: '99999999-9999-4999-8999-999999999999',
      clientId: 'client-9',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'ScaleUp UK', grossPay: 5000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa101: {
        highIncomeChildBenefitCharge: { incomeOverThreshold: false, numberOfChildren: 0, benefitAmountReceived: 0 },
        studentLoan: { planType: 'plan_1' },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // Plan 1 threshold £24,933. Excess = £25,067. 9% = £2,256.00
      assertEq('studentLoanBalanceDue', r.charges.studentLoanBalanceDue, 225600);
    },
  },
  {
    name: 'Case 10: Capital gains listed shares disposal above AEA (£3,000)',
    returnObj: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientId: 'client-10',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Fintech UK', grossPay: 4000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa108: {
        disposals: [{ assetType: 'listed_shares', disposalDate: '2025-08-10', proceeds: 2500000, costs: 1000000, losses: 0, claimBadr: false }],
        broughtForwardLosses: 0,
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // Gain £15,000 - AEA £3,000 = £12,000 taxable.
      assertEq('cgt totalCgtDue', r.cgt?.totalCgtDue || 0, 137300);
    },
  },
  {
    name: 'Case 11: Capital gains residential property disposal at higher rate (24%)',
    returnObj: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      clientId: 'client-11',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'MegaCorp UK', grossPay: 8000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa108: {
        disposals: [{ assetType: 'residential_property', disposalDate: '2025-09-01', proceeds: 40000000, costs: 30000000, losses: 0, claimBadr: false }],
        broughtForwardLosses: 0,
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // Gain £100,000 - AEA £3,000 = £97,000 taxable at higher residential rate 24% = £23,280.
      assertEq('cgt residential higher rate', r.cgt?.totalCgtDue || 0, 2328000);
    },
  },
  {
    name: 'Case 12: FIG regime election forfeits Personal Allowance',
    returnObj: {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      clientId: 'client-12',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Global Expat', grossPay: 5000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      sa109: {
        residenceStatus: {
          daysInUk: 190,
          srtResult: 'resident',
          domicileStatus: 'foreign_domiciled',
          figRegimeElected: true,
          overseasWorkdayReliefClaimed: false,
        },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('personalAllowance forfeited', r.incomeTax.personalAllowance, 0);
      assertEq('figRegimeElected flag', r.figRegimeElected ? 1 : 0, 1);
    },
  },
  {
    name: 'Case 13: Blind Person Allowance (£3,070 added to PA)',
    returnObj: {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      clientId: 'client-13',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: { ...emptyReliefs, blindPersonsAllowance: true } },
      sa102: [{ employerName: 'Acme UK', grossPay: 4000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      // PA £12,570 + BPA £3,070 = £15,640
      assertEq('personalAllowance with BPA', r.incomeTax.personalAllowance, 1564000);
    },
  },
  {
    name: 'Case 14: Multiple employments total pay aggregation',
    returnObj: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      clientId: 'client-14',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [
        { employerName: 'Job 1', grossPay: 3000000, taxDeducted: 400000, benefits: emptyBenefits, expenses: emptyExpenses },
        { employerName: 'Job 2', grossPay: 2000000, taxDeducted: 200000, benefits: emptyBenefits, expenses: emptyExpenses },
      ],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('totalIncome across employments', r.totalIncome, 5000000);
      assertEq('taxAlreadyPaidTotal across employments', r.taxAlreadyPaidTotal, 600000);
    },
  },
  {
    name: 'Case 15: Payments on Account required (> £1,000 net unpaid tax)',
    returnObj: {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      clientId: 'client-15',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{ employerName: 'Unpaid PAYE', grossPay: 8000000, taxDeducted: 0, benefits: emptyBenefits, expenses: emptyExpenses }],
      updatedAt: new Date().toISOString(),
    },
    assertions: (r) => {
      assertEq('paymentsOnAccountRequired', r.paymentsOnAccountRequired ? 1 : 0, 1);
      assertEq('nextYearPaymentOnAccount', r.nextYearPaymentOnAccount, 971600); // 19,432 / 2
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
