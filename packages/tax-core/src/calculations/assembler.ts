import { TaxYearConfig, configHash } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { roundToNearestPenny } from '../utils/rounding.js';
import { computeIncomeTax, ComputeIncomeTaxOutput } from './income-tax.js';
import { computeCgt, CgtResult } from './capital-gains.js';
import { computeFtcr, FtcrResult } from './foreign-tax.js';
import { computeReliefsCharges, ReliefsChargesResult } from './reliefs-charges.js';

const ENGINE_VERSION = '1.1.0';

export interface ComputationVersion {
  taxYear: string;
  engineVersion: string;
  configHash: string;
}

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
  version: ComputationVersion;
  /** Non-blocking notes about interactions not yet modelled. Surface to the agent. */
  warnings: string[];
}

/**
 * Top-level assembler. Runs the return through the calculation modules in HMRC
 * order and returns the full computation plus a version block and warnings.
 *
 * Residence: this trusts the agent-determined SA109 `srtResult` rather than
 * re-deriving it from partial inputs. Full SRT evaluation lives in the residence
 * module and is exercised during the residence phase, not here.
 */
export function computeFullReturn(
  returnObj: Return,
  config: TaxYearConfig
): FullReturnComputation {
  const warnings: string[] = [];
  const sa100 = returnObj.sa100 || ({} as any);
  const reliefs = sa100.reliefs || ({} as any);
  const taxPaid = sa100.taxAlreadyPaid || ({} as any);
  const ukInvestment = sa100.income || ({} as any);

  // --- 1. Residence (trust the SA109 determination) ---
  let isResident = true;
  let figElected = false;

  if (returnObj.sa109 && returnObj.sa109.residenceStatus) {
    const rs = returnObj.sa109.residenceStatus;
    isResident = rs.srtResult !== 'non_resident'; // resident or split_year -> in scope
    figElected = rs.figRegimeElected || false;

    if (rs.srtResult === 'split_year') {
      warnings.push('Split-year treatment is simplified: the full year is treated as resident. Verify the split-year case and apportionment.');
    }
    if (figElected) {
      warnings.push('FIG regime: qualifying foreign income is excluded, but loss of personal allowance / annual exempt amount for FIG claimants is not yet modelled. Verify eligibility (non-resident for the prior 10 years) upstream.');
    }
    if (rs.overseasWorkdayReliefClaimed) {
      warnings.push('Overseas Workday Relief is recorded but not yet applied to the computation.');
    }
  }

  // --- 2. Income by category ---
  let grossEmployment = 0;
  let payeTaxDeducted = 0;

  const sa102List = returnObj.sa102 || [];
  for (const emp of sa102List) {
    const benefits = emp.benefits || ({} as any);
    const expenses = emp.expenses || ({} as any);
    grossEmployment += (emp.grossPay || 0) + (benefits.companyCars || 0) + (benefits.medicalInsurance || 0) + (benefits.otherBenefits || 0);
    grossEmployment -= (expenses.businessTravel || 0) + (expenses.professionalFees || 0) + (expenses.otherExpenses || 0);
    payeTaxDeducted += emp.taxDeducted || 0;
  }

  // Foreign income (SA106). Excluded entirely when FIG is elected.
  let foreignSavings = 0;
  let foreignDividends = 0;
  let foreignOther = 0;
  if (returnObj.sa106 && Array.isArray(returnObj.sa106.foreignIncome) && isResident) {
    for (const item of returnObj.sa106.foreignIncome) {
      if (figElected) continue;
      if (item.incomeType === 'savings') foreignSavings += item.grossAmount || 0;
      else if (item.incomeType === 'dividends') foreignDividends += item.grossAmount || 0;
      else foreignOther += item.grossAmount || 0; // employment/property/other -> non-savings
    }
  }

  // UK domestic investment income (gross), from SA100.income.
  const ukSavingsIncome = ukInvestment.ukSavingsIncome || 0;
  const ukDividendIncome = ukInvestment.ukDividendIncome || 0;

  const nonSavingsIncome = Math.max(0, grossEmployment) + foreignOther;
  const savingsIncome = ukSavingsIncome + foreignSavings;
  const dividendIncome = ukDividendIncome + foreignDividends;

  // --- 3. Income tax ---
  const incomeTaxOutput = computeIncomeTax(
    {
      region: 'rUK', // TODO: derive region from client address / SA109
      nonSavingsIncome,
      savingsIncome,
      dividendIncome,
      giftAidGrossedUp: reliefs.giftAidGrossedUp || 0,
      relievablePensionContributions: reliefs.relievablePensionContributions || 0,
      blindPersonsAllowanceClaimed: reliefs.blindPersonsAllowance || false,
      marriageAllowanceTransferor: reliefs.marriageAllowanceTransferor || false,
      marriageAllowanceRecipient: reliefs.marriageAllowanceRecipient || false,
    },
    config
  );

  // --- 4. Capital gains ---
  // Unused basic-rate band = UK basic band (extended by reliefs) minus ALL
  // taxable income (including amounts covered by 0% allowances, which still
  // occupy band space).
  const reliefExtension = (reliefs.giftAidGrossedUp || 0) + (reliefs.relievablePensionContributions || 0);
  const ukBasicUpper = config.incomeTax.rUK.nonSavings[0].limit + reliefExtension;
  const totalTaxableIncome =
    incomeTaxOutput.taxableNonSavings + incomeTaxOutput.taxableSavings + incomeTaxOutput.taxableDividends;
  const unusedBasicRateBand = Math.max(0, ukBasicUpper - totalTaxableIncome);

  let cgtOutput: CgtResult | undefined;
  if (returnObj.sa108 && Array.isArray(returnObj.sa108.disposals) && returnObj.sa108.disposals.length > 0) {
    cgtOutput = computeCgt(
      {
        disposals: returnObj.sa108.disposals.map(d => ({
          assetType: d.assetType,
          proceeds: d.proceeds || 0,
          costs: d.costs || 0,
          losses: d.losses || 0,
          claimBadr: d.claimBadr || false,
        })),
        broughtForwardLosses: returnObj.sa108.broughtForwardLosses || 0,
        unusedBasicRateBand,
      },
      config
    );
  }

  // --- 5. Foreign Tax Credit Relief ---
  // NOTE: per-source UK tax is still approximated by proportional apportionment.
  // Correct method is top-slicing (tax with vs without the source). Tracked as H6.
  let ftcrOutput: FtcrResult | undefined;
  if (returnObj.sa106 && Array.isArray(returnObj.sa106.foreignIncome) && isResident && !figElected) {
    const totalIncome = nonSavingsIncome + savingsIncome + dividendIncome;
    const ukTaxOnForeignIncome: Record<string, number> = {};
    returnObj.sa106.foreignIncome.forEach((item, index) => {
      const key = `${item.countryCode}_${item.incomeType}_${index}`;
      ukTaxOnForeignIncome[key] = totalIncome > 0
        ? roundToNearestPenny(incomeTaxOutput.incomeTaxTotal * ((item.grossAmount || 0) / totalIncome))
        : 0;
    });
    ftcrOutput = computeFtcr({ foreignItems: returnObj.sa106.foreignIncome, ukTaxOnForeignIncome }, config);
    if (ftcrOutput.totalAllowedCredit > 0) {
      warnings.push('FTCR uses approximate proportional apportionment of UK tax per source, not HMRC top-slicing. Verify before filing.');
    }
  }

  // --- 6. Charges ---
  const adjustedNetIncome = Math.max(0, (nonSavingsIncome + savingsIncome + dividendIncome) - reliefExtension);
  const childBenefit = returnObj.sa101?.highIncomeChildBenefitCharge?.benefitAmountReceived || 0;
  const planType = returnObj.sa101?.studentLoan?.planType || 'none';

  const charges = computeReliefsCharges(
    {
      adjustedNetIncome,
      childBenefitReceived: childBenefit,
      studentLoanPlanType: planType,
      totalIncomeForStudentLoan: nonSavingsIncome + savingsIncome + dividendIncome,
      studentLoanAlreadyDeducted: 0,
    },
    config
  );

  // --- 7. Balancing payment ---
  const ftcrCredit = ftcrOutput ? ftcrOutput.totalAllowedCredit : 0;
  const netIncomeTax = Math.max(0, incomeTaxOutput.incomeTaxTotal - ftcrCredit);
  const totalCgt = cgtOutput ? cgtOutput.totalCgtDue : 0;

  const totalTaxLiability = netIncomeTax + totalCgt + charges.hicbcAmount + charges.studentLoanBalanceDue;

  // Tax paid at source. NOTE: sa100.taxAlreadyPaid.payeTax is intentionally NOT
  // added here to avoid double-counting employment taxDeducted.
  const taxAlreadyPaidTotal =
    payeTaxDeducted +
    (taxPaid.cisDeductions || 0) +
    (taxPaid.otherTaxPaid || 0) +
    (taxPaid.taxDeductedFromSavings || 0) +
    (taxPaid.taxDeductedFromDividends || 0);

  const balancingPayment = totalTaxLiability - taxAlreadyPaidTotal;

  // --- 8. Payments on account ---
  // The "relevant amount" = income tax (+ Class 4 NIC, not yet modelled) net of
  // tax deducted at source. CGT, HICBC and student loan are excluded from POA.
  const relevantAmount = Math.max(0, netIncomeTax - taxAlreadyPaidTotal);
  const collectedAtSourceOK = netIncomeTax > 0 && taxAlreadyPaidTotal >= 0.8 * netIncomeTax;
  const paymentsOnAccountRequired = relevantAmount > 100000 && netIncomeTax > 0 && !collectedAtSourceOK;
  const nextYearPaymentOnAccount = paymentsOnAccountRequired ? roundToNearestPenny(relevantAmount / 2) : 0;

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
    version: {
      taxYear: config.taxYear,
      engineVersion: ENGINE_VERSION,
      configHash: configHash(config),
    },
    warnings,
  };
}
