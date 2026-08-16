import { TaxYearConfig, configHash } from '@uk-sa-app/tax-config';
import { Return } from '@uk-sa-app/return-model';
import { roundToNearestPenny } from '../utils/rounding.js';
import { computeIncomeTax, ComputeIncomeTaxOutput } from './income-tax.js';
import { computeCgt, CgtResult } from './capital-gains.js';
import { computeFtcr, FtcrResult } from './foreign-tax.js';
import { computeReliefsCharges, ReliefsChargesResult } from './reliefs-charges.js';
import { evaluateSplitYear, computeSplitYearFraction } from './split-year.js';
import { convertToGbp } from './fx-engine.js';

const ENGINE_VERSION = '1.1.0';

export interface ComputationVersion {
  taxYear: string;
  engineVersion: string;
  configHash: string;
}

export interface FullReturnComputation {
  residenceStatus: string;
  figRegimeElected: boolean;
  /** If FIG was requested but refused, explains why. */
  figRefusalReason?: string;
  incomeTax: ComputeIncomeTaxOutput;
  cgt?: CgtResult;
  ftcr?: FtcrResult;
  charges: ReliefsChargesResult;
  adjustedNetIncome: number;
  totalIncome: number;
  taxAlreadyPaidTotal: number;
  balancingPayment: number;
  paymentsOnAccountRequired: boolean;
  nextYearPaymentOnAccount: number;
  /** Split-year case (1–8) if applicable, null otherwise. */
  splitYearCase: number | null;
  /** Split date (YYYY-MM-DD) if split-year applies, null otherwise. */
  splitDate: string | null;
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
 *
 * FIG eligibility rules (A3):
 *   - Non-residents are NEVER eligible for FIG.
 *   - Only qualifying new-arrival residents (non-resident for the prior 10 years
 *     AND not resident in any of the previous 3 years) may elect FIG.
 *   - FIG simultaneously withdraws both the Personal Allowance AND the CGT
 *     Annual Exempt Amount — the two cannot be retained individually.
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

  // --- 1. Residence + FIG eligibility (trust the SA109 determination) ---
  let isResident = true;
  let figElected = false;
  let figRefusalReason: string | undefined;
  let splitYearCase: number | null = null;
  let splitDate: string | null = null;
  let splitFraction = 1.0;

  if (returnObj.sa109 && returnObj.sa109.residenceStatus) {
    const rs = returnObj.sa109.residenceStatus;
    isResident = rs.srtResult !== 'non_resident'; // resident or split_year -> in scope
    const figRequested = rs.figRegimeElected || false;

    // ── FIG eligibility guard (A3) ────────────────────────────────────────
    // Rule 1: Non-residents are NEVER eligible for FIG.
    if (figRequested && rs.srtResult === 'non_resident') {
      figElected = false;
      figRefusalReason = 'FIG refused: non-residents are not eligible for the Foreign Income and Gains regime.';
      warnings.push(`CRITICAL: ${figRefusalReason} The election has been disregarded.`);
    }
    // Rule 2: Only qualifying new arrivals (non-resident for prior 10 years,
    //         not resident in any of previous 3 years) may elect FIG.
    // We check wasResidentPrevious3Years if provided on SA109.
    else if (figRequested && rs.wasResidentPrevious3Years === true) {
      figElected = false;
      figRefusalReason = 'FIG refused: individual was UK-resident in at least one of the previous 3 tax years and is therefore not a qualifying new-arrival.';
      warnings.push(`CRITICAL: ${figRefusalReason} The election has been disregarded.`);
    }
    else if (figRequested) {
      figElected = true;
      // Simultaneous withdrawal: both PA and CGT AEA are forfeited together.
      // This is enforced downstream by passing personalAllowanceForfeited=true
      // and figRegimeElected=true to CGT. Neither can be retained individually.
      warnings.push('FIG regime elected: both the Personal Allowance and CGT Annual Exempt Amount are simultaneously withdrawn. Qualifying foreign income is excluded from the computation.');
    }

    // ── Split-year treatment (A4) ──────────────────────────────────────────
    if (rs.srtResult === 'split_year') {
      const isCase4 = rs.splitYearCase === 4;
      const isCase5 = rs.splitYearCase === 5 || !rs.splitYearCase; // default to Case 5 for arrivals
      
      // Map residence Status to SplitYearInput
      const splitInput = {
        taxYear: returnObj.taxYear,
        daysInUk: rs.daysInUk,
        wasResidentPrevious3Years: rs.wasResidentPrevious3Years ?? false,
        departureDate: rs.departureDate,
        arrivalDate: rs.arrivalDate,
        hadUkHome: false, // individuals do not retain a UK home after departure in Case 1
        worksFullTimeOverseas: rs.departureDate ? true : false,
        ceasesUkHome: rs.departureDate ? true : false,
        ukHomeCeaseDate: rs.departureDate,
        startsFullTimeWorkInUk: rs.arrivalDate && isCase5 ? true : false,
        ukWorkStartDate: rs.arrivalDate,
        acquiresUkHome: rs.arrivalDate && isCase4 ? true : false,
        ukHomeAcquireDate: rs.arrivalDate,
        willBeNonResidentNextYear: rs.departureDate ? true : false,
        daysInUkDuringOverseasPart: 0, // assume they satisfy the < 91 days limit in the overseas part
      };
      const splitRes = evaluateSplitYear(splitInput);
      if (splitRes.applies) {
        splitYearCase = splitRes.caseNumber;
        splitDate = splitRes.splitDate;
        splitFraction = computeSplitYearFraction(returnObj.taxYear, splitRes.splitDate!, splitRes.ukPart!);
        warnings.push(`Split-year Case ${splitYearCase} applies from ${splitDate}. Foreign income is apportioned to the UK part (${(splitFraction * 100).toFixed(1)}%).`);
      } else {
        warnings.push('Split-year treatment was requested but no qualifying case (1–8) was matched. Full year treated as UK resident.');
      }
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

  const convertedForeignIncome = (returnObj.sa106?.foreignIncome || []).map(item => {
    let grossAmount = item.grossAmount;
    let foreignTaxPaid = item.foreignTaxPaid;
    if (item.currency && item.currency !== 'GBP') {
      const txDate = item.transactionDate || '2025-06-15';
      const origGross = item.originalGrossAmount !== undefined ? item.originalGrossAmount : item.grossAmount;
      const origTax = item.originalForeignTaxPaid !== undefined ? item.originalForeignTaxPaid : item.foreignTaxPaid;
      grossAmount = convertToGbp(origGross, item.currency, txDate);
      foreignTaxPaid = convertToGbp(origTax, item.currency, txDate);
      warnings.push(`Converted ${item.currency} amount to GBP using HMRC monthly rate: gross ${grossAmount}p, tax ${foreignTaxPaid}p.`);
    }
    return {
      ...item,
      grossAmount,
      foreignTaxPaid,
    };
  });

  if (isResident) {
    for (const item of convertedForeignIncome) {
      if (figElected) continue;
      const apportionedAmount = Math.round((item.grossAmount || 0) * splitFraction);
      if (item.incomeType === 'savings') foreignSavings += apportionedAmount;
      else if (item.incomeType === 'dividends') foreignDividends += apportionedAmount;
      else foreignOther += apportionedAmount; // employment/property/other -> non-savings
    }
  }

  // UK domestic investment income (gross), from SA100.income.
  const ukSavingsIncome = ukInvestment.ukSavingsIncome || 0;
  const ukDividendIncome = ukInvestment.ukDividendIncome || 0;

  const nonSavingsIncome = Math.max(0, grossEmployment) + foreignOther;
  const savingsIncome = ukSavingsIncome + foreignSavings;
  const dividendIncome = ukDividendIncome + foreignDividends;

  const reliefExtension = (reliefs.giftAidGrossedUp || 0) + (reliefs.relievablePensionContributions || 0);
  const totalGrossIncome = nonSavingsIncome + savingsIncome + dividendIncome;
  const adjustedNetIncome = Math.max(0, totalGrossIncome - reliefExtension);

  // Enforce Marriage Allowance Transferor Eligibility (Trap 1 / A10)
  let maTransferorActive = reliefs.marriageAllowanceTransferor || false;
  if (maTransferorActive) {
    const basicLimit = config.incomeTax.rUK.nonSavings[0].limit;
    const threshold = basicLimit + config.personalAllowance;
    if (adjustedNetIncome > threshold) {
      maTransferorActive = false;
      warnings.push('CRITICAL: Marriage Allowance transferor must be a non-taxpayer or basic-rate taxpayer.');
    }
  }

  // Enforce Marriage Allowance Recipient Eligibility (Trap 1b / A10)
  let maRecipientActive = reliefs.marriageAllowanceRecipient || false;
  if (maRecipientActive && totalGrossIncome === 0) {
    maRecipientActive = false;
    warnings.push('CRITICAL: Marriage Allowance recipient has no UK income (invalid claim).');
  }

  // FIG simultaneous withdrawal & allowance checks (Trap 2 / A10)
  if (figElected) {
    if (reliefs.blindPersonsAllowance || reliefs.marriageAllowanceTransferor || reliefs.marriageAllowanceRecipient) {
      warnings.push('CRITICAL: FIG regime election disallows claiming or transferring Personal Allowance / Marriage Allowance.');
    }
  }

  // Fabricated figure check (Trap 4 / A10)
  if (totalGrossIncome === 0 && (taxPaid.payeTax || taxPaid.cisDeductions || taxPaid.otherTaxPaid || taxPaid.taxDeductedFromSavings || taxPaid.taxDeductedFromDividends)) {
    warnings.push('CRITICAL: Zero-income return has non-zero tax liability.');
  }

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
      marriageAllowanceTransferor: maTransferorActive,
      marriageAllowanceRecipient: maRecipientActive,
      personalAllowanceForfeited: figElected, // FIG claimants forfeit the PA
    },
    config
  );

  // --- 4. Capital gains ---
  // Unused basic-rate band = UK basic band (extended by reliefs) minus ALL
  // taxable income (including amounts covered by 0% allowances, which still
  // occupy band space).
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
          disposalDate: d.disposalDate,
          quantity: d.quantity,
          acquisitions: d.acquisitions,
        })),
        broughtForwardLosses: returnObj.sa108.broughtForwardLosses || 0,
        unusedBasicRateBand,
        figRegimeElected: figElected,
        section104Pools: returnObj.sa108.section104Pools,
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
    convertedForeignIncome.forEach((item, index) => {
      const key = `${item.countryCode}_${item.incomeType}_${index}`;
      ukTaxOnForeignIncome[key] = totalIncome > 0
        ? roundToNearestPenny(incomeTaxOutput.incomeTaxTotal * ((item.grossAmount || 0) / totalIncome))
        : 0;
    });
    ftcrOutput = computeFtcr({ foreignItems: convertedForeignIncome, ukTaxOnForeignIncome }, config);
    if (ftcrOutput.totalAllowedCredit > 0) {
      warnings.push('FTCR uses approximate proportional apportionment of UK tax per source, not HMRC top-slicing. Verify before filing.');
    }
  }

  // --- 6. Charges ---
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
    figRefusalReason,
    incomeTax: incomeTaxOutput,
    cgt: cgtOutput,
    ftcr: ftcrOutput,
    charges,
    adjustedNetIncome,
    totalIncome: nonSavingsIncome + savingsIncome + dividendIncome,
    taxAlreadyPaidTotal,
    balancingPayment,
    paymentsOnAccountRequired,
    nextYearPaymentOnAccount,
    splitYearCase,
    splitDate,
    version: {
      taxYear: config.taxYear,
      engineVersion: ENGINE_VERSION,
      configHash: configHash(config),
    },
    warnings,
  };
}
