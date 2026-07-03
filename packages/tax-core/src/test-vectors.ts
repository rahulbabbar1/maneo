import { computeFullReturn, FullReturnComputation } from './calculations/assembler.js';
import { Return } from '@uk-sa-app/return-model';
import { CONFIG_2025_26 } from '@uk-sa-app/tax-config';

interface GoldenVector {
  name: string;
  returnObj: Return;
  assertions: (result: FullReturnComputation) => void;
}

const GOLDEN_VECTORS: GoldenVector[] = [
  {
    name: 'Case 1: Standard Salaried Foreign National with Foreign Dividends',
    returnObj: {
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
          employerName: 'Acme Corp UK',
          grossPay: 8500000, // £85,000 in pence
          taxDeducted: 2012300, // £20,123 in pence
          benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
          expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
        },
      ],
      sa106: {
        foreignIncome: [
          {
            countryCode: 'IND',
            incomeType: 'dividends',
            grossAmount: 500000, // £5,000 in pence
            foreignTaxPaid: 75000, // £750 in pence (15% cap)
            claimFtcr: true,
          },
        ],
        remittanceBasis: {
          claimRemittanceBasis: false,
          remittedAmount: 0,
          remittanceChargePaid: 0,
        },
      },
      updatedAt: new Date().toISOString(),
    },
    assertions: (result) => {
      console.log(`  - Residence status: ${result.residenceStatus}`);
      console.log(`  - Personal Allowance: £${(result.incomeTax.personalAllowance / 100).toLocaleString()}`);
      console.log(`  - Total Income Tax: £${(result.incomeTax.incomeTaxTotal / 100).toLocaleString()}`);
      console.log(`  - Allowed FTCR Credit: £${((result.ftcr?.totalAllowedCredit || 0) / 100).toLocaleString()}`);
      
      // Personal allowance should be full £12,570 (since net income £90,000 < £100,000)
      if (result.incomeTax.personalAllowance !== 1257000) {
        throw new Error(`Expected Personal Allowance to be 1257000, got ${result.incomeTax.personalAllowance}`);
      }
      
      // FTCR should be allowed (lower of India 15% dividend cap which is £750 and UK dividend tax)
      const allowedCredit = result.ftcr?.totalAllowedCredit || 0;
      if (allowedCredit !== 75000) {
        throw new Error(`Expected allowed FTCR credit to be 75000, got ${allowedCredit}`);
      }
    },
  },
  {
    name: 'Case 2: High Income Tapered Personal Allowance',
    returnObj: {
      id: 'b8f2130f-dd1d-44b0-a5d6-c55b099b8fdc',
      clientId: 'client-2',
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
          employerName: 'Global Corp UK',
          grossPay: 14000000, // £140,000 in pence (fully tapered)
          taxDeducted: 4500000,
          benefits: { companyCars: 0, medicalInsurance: 0, otherBenefits: 0 },
          expenses: { businessTravel: 0, professionalFees: 0, otherExpenses: 0 },
        },
      ],
      updatedAt: new Date().toISOString(),
    },
    assertions: (result) => {
      console.log(`  - Personal Allowance: £${(result.incomeTax.personalAllowance / 100).toLocaleString()}`);
      if (result.incomeTax.personalAllowance !== 0) {
        throw new Error(`Expected tapered Personal Allowance to be 0, got ${result.incomeTax.personalAllowance}`);
      }
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
      console.log('✓ Success');
    } catch (error: any) {
      console.error('✗ Failure:', error.message || error);
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
