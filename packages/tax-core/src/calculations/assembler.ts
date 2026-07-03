import { TaxYearConfig } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { computeIncomeTax, ComputeIncomeTaxOutput } from './income-tax.js';
import { evaluateSrt } from './residence.js';
import { computeCgt, CgtResult } from './capital-gains.js';
import { computeFtcr, FtcrResult } from './foreign-tax.js';
import { computeReliefsCharges, ReliefsChargesResult } from './reliefs-charges.js';

export interface FullReturnComputation {
  residenceStatus: string;
  figRegimeElected: boolean;
  incomeTax: ComputeIncomeTaxOutput;
  cgt?: CgtResult;
  ftcr?: FtcrResult;
  charges: ReliefsChargesResult;
  taxAlreadyPaidTotal: number;
  balancingPayment: number;
  paymentsOnAccountRequired: boolean;
  nextYearPaymentOnAccount: number;
}

/**
 * Top-level Assembler. Evaluates a full Return object in HMRC-prescribed sequence:
 * 1. Residence & FIG eligibility checks
 * 2. Employment and non-savings totals
 * 3. Income Tax band allocation
 * 4. Capital Gains Tax allocation
 * 5. Double taxation FTCR capping
 * 6. Child Benefit & Student Loan charges
 * 7. Deduct tax already paid at source to reach final balancing payment
 */
export function computeFullReturn(
  returnObj: Return,
  config: TaxYearConfig
): FullReturnComputation {
  const sa100 = returnObj.sa100 || {};
  const reliefs = sa100.reliefs || {};
  const taxPaid = sa100.taxAlreadyPaid || {};

  // --- 1. Residence Evaluation ---
  let isResident = true;
  let figElected = false;

  if (returnObj.sa109 && returnObj.sa109.residenceStatus) {
    const srtInput = {
      daysInUk: returnObj.sa109.residenceStatus.daysInUk || 0,
      wasResidentInPrevious3Years: returnObj.sa109.residenceStatus.srtResult !== 'non_resident',
      nonResidentPrevious10Years: returnObj.sa109.residenceStatus.figRegimeElected || false, // assumption
      hadUkHome: false,
      workedFullTimeInUk: false,
      workedFullTimeOverseas: false,
      ties: {
        familyTie: false,
        accommodationTie: false,
        workTie: false,
        ninetyDayTie: false,
        countryTie: false,
      },
    };
    const srt = evaluateSrt(srtInput, config);
    isResident = srt.isResident;
    figElected = returnObj.sa109.residenceStatus.figRegimeElected && srt.figRegimeEligible;
  }

  // --- 2. Calculate Gross Income Categories ---
  let grossEmployment = 0;
  let payeTaxDeducted = 0;

  // SA102 Employments
  const sa102List = returnObj.sa102 || [];
  for (const emp of sa102List) {
    const benefits = emp.benefits || {};
    const expenses = emp.expenses || {};
    grossEmployment += (emp.grossPay || 0) + (benefits.companyCars || 0) + (benefits.medicalInsurance || 0) + (benefits.otherBenefits || 0);
    grossEmployment -= (expenses.businessTravel || 0) + (expenses.professionalFees || 0) + (expenses.otherExpenses || 0);
    payeTaxDeducted += emp.taxDeducted || 0;
  }

  // SA106 Foreign Income
  let foreignSavings = 0;
  let foreignDividends = 0;
  let foreignOther = 0;

  if (returnObj.sa106 && Array.isArray(returnObj.sa106.foreignIncome) && isResident) {
    for (const item of returnObj.sa106.foreignIncome) {
      // If FIG is elected, qualifying foreign income is fully excluded from UK tax
      if (figElected) continue;

      if (item.incomeType === 'savings') {
        foreignSavings += item.grossAmount || 0;
      } else if (item.incomeType === 'dividends') {
        foreignDividends += item.grossAmount || 0;
      } else {
        foreignOther += item.grossAmount || 0;
      }
    }
  }

  // Total income categories
  const nonSavingsIncome = grossEmployment + foreignOther;
  const savingsIncome = (taxPaid.taxDeductedFromSavings || 0) + foreignSavings; // simple aggregation
  const dividendIncome = (taxPaid.taxDeductedFromDividends || 0) + foreignDividends;

  // --- 3. Compute Income Tax ---
  const incomeTaxInput = {
    region: 'rUK' as const, // default to rest of UK for assembler
    nonSavingsIncome,
    savingsIncome,
    dividendIncome,
    giftAidGrossedUp: reliefs.giftAidGrossedUp || 0,
    relievablePensionContributions: reliefs.relievablePensionContributions || 0,
    blindPersonsAllowanceClaimed: reliefs.blindPersonsAllowance || false,
  };
  const incomeTaxOutput = computeIncomeTax(incomeTaxInput, config);

  // --- 4. Compute Capital Gains Tax ---
  // Unused basic rate band = total basic rate band width - basic rate band used in income tax
  const basicLimit = config.incomeTax.rUK.nonSavings[0].limit + (reliefs.giftAidGrossedUp || 0) + (reliefs.relievablePensionContributions || 0);
  const allocatedBasicRate = incomeTaxOutput.allocatedBands
    .filter(b => b.name === 'basic')
    .reduce((acc, curr) => acc + curr.amountAllocated, 0);
  const unusedBasicRateBand = Math.max(0, basicLimit - allocatedBasicRate);

  let cgtOutput: CgtResult | undefined;
  if (returnObj.sa108 && Array.isArray(returnObj.sa108.disposals)) {
    const cgtInput = {
      disposals: returnObj.sa108.disposals.map(d => ({
        assetType: d.assetType,
        proceeds: d.proceeds || 0,
        costs: d.costs || 0,
        losses: d.losses || 0,
        claimBadr: d.claimBadr || false,
      })),
      broughtForwardLosses: returnObj.sa108.broughtForwardLosses || 0,
      unusedBasicRateBand,
    };
    cgtOutput = computeCgt(cgtInput, config);
  }

  // --- 5. Compute Foreign Tax Credit Relief (FTCR) ---
  let ftcrOutput: FtcrResult | undefined;
  if (returnObj.sa106 && Array.isArray(returnObj.sa106.foreignIncome) && isResident && !figElected) {
    // Determine UK tax generated by each foreign item
    // In actual system, we do a marginal tax comparison.
    // For this implementation, we associate a proportional slice of total tax as a baseline
    const totalIncome = nonSavingsIncome + savingsIncome + dividendIncome;
    const ukTaxOnForeignIncome: Record<string, number> = {};

    returnObj.sa106.foreignIncome.forEach((item, index) => {
      const key = `${item.countryCode}_${item.incomeType}_${index}`;
      if (totalIncome > 0) {
        const proportion = (item.grossAmount || 0) / totalIncome;
        ukTaxOnForeignIncome[key] = Math.round(incomeTaxOutput.incomeTaxTotal * proportion);
      } else {
        ukTaxOnForeignIncome[key] = 0;
      }
    });

    ftcrOutput = computeFtcr({
      foreignItems: returnObj.sa106.foreignIncome,
      ukTaxOnForeignIncome,
    }, config);
  }

  // --- 6. Compute Additional Charges ---
  const adjustedNetIncome = Math.max(0, (nonSavingsIncome + savingsIncome + dividendIncome) - ((reliefs.giftAidGrossedUp || 0) + (reliefs.relievablePensionContributions || 0)));
  
  // Expose child benefit input from sa101
  const childBenefit = returnObj.sa101?.highIncomeChildBenefitCharge?.benefitAmountReceived || 0;
  const planType = returnObj.sa101?.studentLoan?.planType || 'none';

  const charges = computeReliefsCharges({
    adjustedNetIncome,
    childBenefitReceived: childBenefit,
    studentLoanPlanType: planType,
    totalIncomeForStudentLoan: nonSavingsIncome + savingsIncome + dividendIncome,
    studentLoanAlreadyDeducted: 0,
  }, config);

  // --- 7. Balancing Payment & Payments on Account ---
  const ftcrCredit = ftcrOutput ? ftcrOutput.totalAllowedCredit : 0;
  const netIncomeTax = Math.max(0, incomeTaxOutput.incomeTaxTotal - ftcrCredit);
  const totalCgt = cgtOutput ? cgtOutput.totalCgtDue : 0;
  
  const totalTaxLiability = netIncomeTax + totalCgt + charges.hicbcAmount + charges.studentLoanBalanceDue;
  
  // Deduct tax already paid
  const taxAlreadyPaidTotal = payeTaxDeducted + (taxPaid.cisDeductions || 0) + (taxPaid.otherTaxPaid || 0);
  const balancingPayment = totalTaxLiability - taxAlreadyPaidTotal;

  // Payments on account are required if:
  // - Balancing payment is > £1,000
  // - And tax paid at source is < 80% of total tax liability
  const SourceTaxThreshold = Math.round(totalTaxLiability * 0.80);
  const paymentsOnAccountRequired = balancingPayment > 100000 && taxAlreadyPaidTotal < SourceTaxThreshold;
  const nextYearPaymentOnAccount = paymentsOnAccountRequired ? Math.round(netIncomeTax / 2) : 0;

  return {
    residenceStatus: isResident ? 'UK Resident' : 'Non UK Resident',
    figRegimeElected: figElected,
    incomeTax: incomeTaxOutput,
    cgt: cgtOutput,
    ftcr: ftcrOutput,
    charges,
    taxAlreadyPaidTotal,
    balancingPayment,
    paymentsOnAccountRequired,
    nextYearPaymentOnAccount,
  };
}
