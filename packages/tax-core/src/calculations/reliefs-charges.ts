import { TaxYearConfig } from '@uk-sa-app/tax-config';

export interface ReliefsChargesInput {
  adjustedNetIncome: number; // pence
  childBenefitReceived: number; // pence (if any)
  studentLoanPlanType: 'plan_1' | 'plan_2' | 'plan_4' | 'plan_5' | 'postgraduate' | 'none';
  totalIncomeForStudentLoan: number; // pence
  studentLoanAlreadyDeducted: number; // pence
}

export interface ReliefsChargesResult {
  hicbcAmount: number; // pence
  hicbcPercentage: number; // e.g. 0.45 for 45%
  studentLoanRepayment: number; // pence
  studentLoanBalanceDue: number; // pence (after deducting PAYE deductions)
}

/**
 * Computes High Income Child Benefit Charge (HICBC) and Student Loan repayments.
 */
export function computeReliefsCharges(
  input: ReliefsChargesInput,
  config: TaxYearConfig
): ReliefsChargesResult {
  const {
    adjustedNetIncome,
    childBenefitReceived,
    studentLoanPlanType,
    totalIncomeForStudentLoan,
    studentLoanAlreadyDeducted,
  } = input;

  // 1. Compute HICBC
  let hicbcAmount = 0;
  let hicbcPercentage = 0;

  if (childBenefitReceived > 0 && adjustedNetIncome > config.hicbc.lowerThreshold) {
    if (adjustedNetIncome >= config.hicbc.upperThreshold) {
      hicbcPercentage = 1.0;
      hicbcAmount = childBenefitReceived;
    } else {
      const excess = adjustedNetIncome - config.hicbc.lowerThreshold;
      // 1% increase for every £160 (16000 pence) of excess income
      const percentSteps = Math.floor(excess / config.hicbc.divisor);
      hicbcPercentage = Math.min(100, percentSteps) / 100;
      hicbcAmount = Math.round(childBenefitReceived * hicbcPercentage);
    }
  }

  // 2. Compute Student Loan Repayment
  let studentLoanRepayment = 0;
  let studentLoanBalanceDue = 0;

  if (studentLoanPlanType !== 'none') {
    let planConfig;
    if (studentLoanPlanType === 'plan_1') planConfig = config.studentLoans.plan1;
    else if (studentLoanPlanType === 'plan_2') planConfig = config.studentLoans.plan2;
    else if (studentLoanPlanType === 'plan_4') planConfig = config.studentLoans.plan4;
    else if (studentLoanPlanType === 'plan_5') planConfig = config.studentLoans.plan5;
    else if (studentLoanPlanType === 'postgraduate') planConfig = config.studentLoans.postgrad;

    if (planConfig && totalIncomeForStudentLoan > planConfig.threshold) {
      const excess = totalIncomeForStudentLoan - planConfig.threshold;
      // Round down to nearest pound for student loan calculations per HMRC rules
      const excessPounds = Math.floor(excess / 100);
      const repaymentPounds = Math.floor(excessPounds * planConfig.rate);
      studentLoanRepayment = repaymentPounds * 100; // back to pence

      // Deduct amounts already paid via PAYE
      studentLoanBalanceDue = Math.max(0, studentLoanRepayment - studentLoanAlreadyDeducted);
    }
  }

  return {
    hicbcAmount,
    hicbcPercentage,
    studentLoanRepayment,
    studentLoanBalanceDue,
  };
}
