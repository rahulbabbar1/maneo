import { Return } from '@uk-sa-app/return-model';

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

export interface TrapVector {
  name: string;
  returnObj: Return;
  expectedFailureReason: string;
}

export const TRAP_VECTORS: TrapVector[] = [
  {
    name: 'Trap 1: Marriage Allowance Transferor above basic-rate limit',
    returnObj: {
      id: 'trap-v01-0001-0001-0001-000000000001',
      clientId: 'trap-client-1',
      taxYear: '2025-26',
      status: 'draft',
      sa100: {
        taxAlreadyPaid: emptyTaxPaid,
        reliefs: { ...emptyReliefs, marriageAllowanceTransferor: true },
      },
      sa102: [{
        employerName: 'MTR-Corp-HighIncome',
        grossPay: 6000000, // £60k (above basic-rate threshold of £50,270)
        taxDeducted: 1100000,
        benefits: emptyBenefits,
        expenses: emptyExpenses,
      }],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expectedFailureReason: 'Marriage Allowance transferor must be a non-taxpayer or basic-rate taxpayer.',
  },
  {
    name: 'Trap 1b: Marriage Allowance Recipient with zero UK income',
    returnObj: {
      id: 'trap-v01-0002-0002-0002-000000000002',
      clientId: 'trap-client-2',
      taxYear: '2025-26',
      status: 'draft',
      sa100: {
        taxAlreadyPaid: emptyTaxPaid,
        reliefs: { ...emptyReliefs, marriageAllowanceRecipient: true },
      },
      sa102: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expectedFailureReason: 'Marriage Allowance recipient has no UK income (invalid claim).',
  },
  {
    name: 'Trap 2: FIG elected but claiming Personal/Marriage Allowance',
    returnObj: {
      id: 'trap-v02-0001-0001-0001-000000000001',
      clientId: 'trap-client-3',
      taxYear: '2025-26',
      status: 'draft',
      sa100: {
        taxAlreadyPaid: emptyTaxPaid,
        reliefs: { ...emptyReliefs, blindPersonsAllowance: true }, // PA claim
      },
      sa102: [{
        employerName: 'MTR-Corp',
        grossPay: 4000000,
        taxDeducted: 500000,
        benefits: emptyBenefits,
        expenses: emptyExpenses,
      }],
      sa109: {
        residenceStatus: {
          daysInUk: 200,
          srtResult: 'resident',
          domicileStatus: 'foreign_domiciled',
          figRegimeElected: true,
          overseasWorkdayReliefClaimed: false,
          wasResidentPrevious3Years: false,
          nonResidentPrevious10Years: true,
        },
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expectedFailureReason: 'FIG regime election disallows claiming or transferring Personal Allowance / Marriage Allowance.',
  },
  {
    name: 'Trap 3: FIG elected but non-resident',
    returnObj: {
      id: 'trap-v03-0001-0001-0001-000000000001',
      clientId: 'trap-client-4',
      taxYear: '2025-26',
      status: 'draft',
      sa100: { taxAlreadyPaid: emptyTaxPaid, reliefs: emptyReliefs },
      sa102: [{
        employerName: 'MTR-Corp',
        grossPay: 4000000,
        taxDeducted: 500000,
        benefits: emptyBenefits,
        expenses: emptyExpenses,
      }],
      sa109: {
        residenceStatus: {
          daysInUk: 30,
          srtResult: 'non_resident',
          domicileStatus: 'foreign_domiciled',
          figRegimeElected: true,
          overseasWorkdayReliefClaimed: false,
        },
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expectedFailureReason: 'FIG refused: non-residents are not eligible for the Foreign Income and Gains regime.',
  },
  {
    name: 'Trap 4: Fabricated figure (zero income but non-zero tax)',
    returnObj: {
      id: 'trap-v04-0001-0001-0001-000000000001',
      clientId: 'trap-client-5',
      taxYear: '2025-26',
      status: 'draft',
      sa100: {
        taxAlreadyPaid: { ...emptyTaxPaid, otherTaxPaid: 100000 },
        reliefs: emptyReliefs
      },
      sa102: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    expectedFailureReason: 'Zero-income return has non-zero tax liability.',
  },
];
