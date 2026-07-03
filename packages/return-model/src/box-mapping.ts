export interface BoxMapping {
  fieldPath: string;
  saForm: 'SA100' | 'SA102' | 'SA106' | 'SA108' | 'SA109' | 'SA101';
  saBox: string;
  mtdParameter?: string;
  description: string;
}

export const BOX_MAPPINGS: BoxMapping[] = [
  // SA100 Core
  {
    fieldPath: 'sa100.reliefs.giftAidGrossedUp',
    saForm: 'SA100',
    saBox: 'TR4.1',
    mtdParameter: 'giftAidPayments',
    description: 'Gift Aid payments made in the tax year',
  },
  {
    fieldPath: 'sa100.reliefs.relievablePensionContributions',
    saForm: 'SA100',
    saBox: 'TR4.5',
    mtdParameter: 'pensionContributions',
    description: 'Payments to registered pension schemes',
  },
  {
    fieldPath: 'sa100.reliefs.blindPersonsAllowance',
    saForm: 'SA100',
    saBox: 'TR4.2',
    mtdParameter: 'blindPersonsAllowance',
    description: 'Claiming Blind Person\'s Allowance',
  },
  
  // SA102 Employment
  {
    fieldPath: 'sa102.grossPay',
    saForm: 'SA102',
    saBox: 'EMP.1',
    mtdParameter: 'grossPay',
    description: 'Gross pay from employment',
  },
  {
    fieldPath: 'sa102.taxDeducted',
    saForm: 'SA102',
    saBox: 'EMP.2',
    mtdParameter: 'taxDeducted',
    description: 'UK tax taken off pay',
  },
  {
    fieldPath: 'sa102.benefits.companyCars',
    saForm: 'SA102',
    saBox: 'EMP.9',
    mtdParameter: 'carBenefit',
    description: 'Company car benefit',
  },
  {
    fieldPath: 'sa102.benefits.medicalInsurance',
    saForm: 'SA102',
    saBox: 'EMP.11',
    mtdParameter: 'medicalInsuranceBenefit',
    description: 'Private medical/dental insurance benefit',
  },
  {
    fieldPath: 'sa102.expenses.businessTravel',
    saForm: 'SA102',
    saBox: 'EMP.17',
    mtdParameter: 'businessTravelExpenses',
    description: 'Travel and subsistence expenses',
  },

  // SA109 Residence & Domicile
  {
    fieldPath: 'sa109.residenceStatus.daysInUk',
    saForm: 'SA109',
    saBox: 'RES.1',
    mtdParameter: 'daysSpentInUk',
    description: 'Number of days spent in the UK',
  },
  {
    fieldPath: 'sa109.residenceStatus.srtResult',
    saForm: 'SA109',
    saBox: 'RES.2',
    mtdParameter: 'residenceStatus',
    description: 'SRT Residence determination result',
  },
  {
    fieldPath: 'sa109.residenceStatus.figRegimeElected',
    saForm: 'SA109',
    saBox: 'RES.15',
    mtdParameter: 'figElection',
    description: 'Elected for Foreign Income & Gains (FIG) regime',
  },
  {
    fieldPath: 'sa109.residenceStatus.overseasWorkdayReliefClaimed',
    saForm: 'SA109',
    saBox: 'RES.16',
    mtdParameter: 'owrClaimed',
    description: 'Overseas Workday Relief (OWR) claimed',
  },

  // SA101 Additional Info
  {
    fieldPath: 'sa101.studentLoan.planType',
    saForm: 'SA101',
    saBox: 'ADD.1',
    mtdParameter: 'studentLoanPlan',
    description: 'Student loan repayment plan type',
  },
];
