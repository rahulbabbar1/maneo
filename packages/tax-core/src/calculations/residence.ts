import { TaxYearConfig } from '@uk-sa-app/tax-config';

export interface SrtInput {
  daysInUk: number;
  wasResidentInPrevious3Years: boolean;
  nonResidentPrevious10Years: boolean;
  hadUkHome: boolean;
  workedFullTimeInUk: boolean;
  workedFullTimeOverseas: boolean;
  ties: {
    familyTie: boolean;
    accommodationTie: boolean;
    workTie: boolean;
    ninetyDayTie: boolean;
    countryTie: boolean; // only relevant for departing
  };
}

export interface SrtResult {
  isResident: boolean;
  ruleApplied: string;
  splitYearEligible: boolean;
  figRegimeEligible: boolean;
}

/**
 * Evaluates Statutory Residence Test (SRT) status based on UK tax rules.
 * This determines whether the individual is UK resident for tax purposes.
 */
export function evaluateSrt(input: SrtInput, _config: TaxYearConfig): SrtResult {
  const {
    daysInUk,
    wasResidentInPrevious3Years,
    nonResidentPrevious10Years,
    workedFullTimeOverseas,
    workedFullTimeInUk,
    hadUkHome,
    ties,
  } = input;

  // --- 1. Automatic Overseas Tests (AOT) ---
  
  // AOT1: Spends < 16 days in UK and was resident in one or more of previous 3 years
  if (daysInUk < 16 && wasResidentInPrevious3Years) {
    return {
      isResident: false,
      ruleApplied: 'AOT1: Sped less than 16 days in the UK (previously resident)',
      splitYearEligible: false,
      figRegimeEligible: false,
    };
  }

  // AOT2: Spends < 46 days in UK and was not resident in any of previous 3 years
  if (daysInUk < 46 && !wasResidentInPrevious3Years) {
    return {
      isResident: false,
      ruleApplied: 'AOT2: Sped less than 46 days in the UK (not previously resident)',
      splitYearEligible: false,
      figRegimeEligible: nonResidentPrevious10Years,
    };
  }

  // AOT3: Works full-time overseas (e.g. 35h/week average) and spends < 91 days in UK
  if (workedFullTimeOverseas && daysInUk < 91) {
    return {
      isResident: false,
      ruleApplied: 'AOT3: Works full-time overseas and UK days < 91',
      splitYearEligible: false,
      figRegimeEligible: nonResidentPrevious10Years,
    };
  }

  // --- 2. Automatic UK Tests (AUT) ---
  
  // AUT1: Spends 183 days or more in the UK
  if (daysInUk >= 183) {
    return {
      isResident: true,
      ruleApplied: 'AUT1: Sped 183 days or more in the UK',
      splitYearEligible: true,
      figRegimeEligible: nonResidentPrevious10Years,
    };
  }

  // AUT2: Only or main home in the UK
  if (hadUkHome) {
    return {
      isResident: true,
      ruleApplied: 'AUT2: Only or main home in the UK',
      splitYearEligible: true,
      figRegimeEligible: nonResidentPrevious10Years,
    };
  }

  // AUT3: Works full-time in the UK
  if (workedFullTimeInUk) {
    return {
      isResident: true,
      ruleApplied: 'AUT3: Works full-time in the UK',
      splitYearEligible: true,
      figRegimeEligible: nonResidentPrevious10Years,
    };
  }

  // --- 3. Sufficient Ties Test (STT) ---
  
  // Count the ties
  let tieCount = 0;
  if (ties.familyTie) tieCount++;
  if (ties.accommodationTie) tieCount++;
  if (ties.workTie) tieCount++;
  if (ties.ninetyDayTie) tieCount++;
  
  // Country tie is only counted for departing individuals
  if (wasResidentInPrevious3Years && ties.countryTie) {
    tieCount++;
  }

  let isResident = false;
  let ruleApplied = '';

  if (!wasResidentInPrevious3Years) {
    // ARRIVING (not resident in any of previous 3 years)
    if (daysInUk >= 46 && daysInUk <= 90 && tieCount >= 4) {
      isResident = true;
      ruleApplied = `STT (Arriving): Sped ${daysInUk} days and had ${tieCount} ties (>= 4 required)`;
    } else if (daysInUk >= 91 && daysInUk <= 120 && tieCount >= 3) {
      isResident = true;
      ruleApplied = `STT (Arriving): Sped ${daysInUk} days and had ${tieCount} ties (>= 3 required)`;
    } else if (daysInUk >= 121 && daysInUk <= 182 && tieCount >= 2) {
      isResident = true;
      ruleApplied = `STT (Arriving): Sped ${daysInUk} days and had ${tieCount} ties (>= 2 required)`;
    } else {
      isResident = false;
      ruleApplied = `STT (Arriving): Sped ${daysInUk} days and had ${tieCount} ties (did not meet thresholds)`;
    }
  } else {
    // DEPARTING (resident in one or more of previous 3 years)
    if (daysInUk >= 16 && daysInUk <= 45 && tieCount >= 4) {
      isResident = true;
      ruleApplied = `STT (Departing): Sped ${daysInUk} days and had ${tieCount} ties (>= 4 required)`;
    } else if (daysInUk >= 46 && daysInUk <= 90 && tieCount >= 3) {
      isResident = true;
      ruleApplied = `STT (Departing): Sped ${daysInUk} days and had ${tieCount} ties (>= 3 required)`;
    } else if (daysInUk >= 91 && daysInUk <= 120 && tieCount >= 2) {
      isResident = true;
      ruleApplied = `STT (Departing): Sped ${daysInUk} days and had ${tieCount} ties (>= 2 required)`;
    } else if (daysInUk >= 121 && daysInUk <= 182 && tieCount >= 1) {
      isResident = true;
      ruleApplied = `STT (Departing): Sped ${daysInUk} days and had ${tieCount} ties (>= 1 required)`;
    } else {
      isResident = false;
      ruleApplied = `STT (Departing): Sped ${daysInUk} days and had ${tieCount} ties (did not meet thresholds)`;
    }
  }

  return {
    isResident,
    ruleApplied,
    splitYearEligible: isResident, // Simplification for split year
    figRegimeEligible: isResident && nonResidentPrevious10Years,
  };
}
