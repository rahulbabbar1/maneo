/**
 * HMRC reference check for 2025-26.
 *
 * Every constant below is transcribed from HMRC's official test tool
 * "MTR-Tester-2025-26" (or equivalent official documentation).
 * This script asserts CONFIG_2025_26 matches it, so a future accidental
 * edit to a rate or threshold fails CI instead of silently mis-filing tax.
 *
 * Values are in pounds; config is in pence, so we multiply by 100 here.
 * Run after build:  node dist/verify-hmrc-2025-26.js
 */
import { CONFIG_2025_26 as C } from './index.js';

let failures = 0;
function check(label: string, actual: number, expectedPounds: number) {
  const expectedPence = Math.round(expectedPounds * 100);
  if (actual !== expectedPence) {
    console.error(`  ✗ ${label}: config=${actual}p, HMRC=${expectedPence}p (£${expectedPounds})`);
    failures++;
  }
}
function checkRate(label: string, actual: number, expected: number) {
  if (actual !== expected) {
    console.error(`  ✗ ${label}: config=${actual}, HMRC=${expected}`);
    failures++;
  }
}

console.log('Verifying CONFIG_2025_26 against HMRC 2025-26 reference values...');

// Allowances
check('Personal Allowance (P_A)',            C.personalAllowance, 12570);
check('PA taper limit (PA_taper_limit)',     C.personalAllowanceTaperLimit, 100000);
check('Blind Person\'s Allowance (BPA)',     C.blindPersonsAllowance, 3070);
check('Marriage transfer (T_P_A)',           C.marriageAllowanceTransferLimit, 1260);
check('Dividend Allowance (DA)',             C.dividendAllowance, 500);
check('Savings starting-rate band (SR_band)',C.savingsStartingRateLimit, 5000);
check('PSA basic (PSA_BR)',                  C.personalSavingsAllowanceBasic, 1000);
check('PSA higher (PSA_HR)',                 C.personalSavingsAllowanceHigher, 500);
check('PSA additional (PSA_AHR)',            C.personalSavingsAllowanceAdditional, 0);

// rUK income tax bands
const ns = C.incomeTax.rUK.nonSavings;
check('rUK basic band upper (BR_band)',      ns[0].limit, 37700);
check('rUK additional threshold (AHR_band)', ns[1].limit, 125140);
checkRate('rUK basic rate',      ns[0].rate, 0.20);
checkRate('rUK higher rate',     ns[1].rate, 0.40);
checkRate('rUK additional rate', ns[2].rate, 0.45);

const sav = C.incomeTax.rUK.savings;
checkRate('savings basic (SAVBR_rate)',      sav[0].rate, 0.20);
checkRate('savings higher (SAVHR_rate)',     sav[1].rate, 0.40);
checkRate('savings additional (SAVAHR_rate)',sav[2].rate, 0.45);

const div = C.incomeTax.rUK.dividends;
checkRate('dividend basic (DivBR_rate)',      div[0].rate, 0.0875);
checkRate('dividend higher (DivHR_rate)',     div[1].rate, 0.3375);
checkRate('dividend additional (DivAR_rate)', div[2].rate, 0.3935);

// Scotland non-savings bands (bands for 2025-26)
const scotNs = C.incomeTax.scotland.nonSavings;
check('Scotland starter band upper',     scotNs[0].limit, 2306);
check('Scotland basic band upper',       scotNs[1].limit, 13991);
check('Scotland intermediate band upper',scotNs[2].limit, 31092);
check('Scotland higher band upper',      scotNs[3].limit, 62430);
check('Scotland advanced band upper',    scotNs[4].limit, 125140);
checkRate('Scotland starter rate',       scotNs[0].rate, 0.19);
checkRate('Scotland basic rate',         scotNs[1].rate, 0.20);
checkRate('Scotland intermediate rate',  scotNs[2].rate, 0.21);
checkRate('Scotland higher rate',        scotNs[3].rate, 0.42);
checkRate('Scotland advanced rate',      scotNs[4].rate, 0.45);
checkRate('Scotland top rate',           scotNs[5].rate, 0.48);

// Capital gains
check('CGT annual exempt (CG_exempt)',       C.capitalGains.annualExemptAmount, 3000);
checkRate('CGT lower (Lower_CGT_rate)',       C.capitalGains.basicRate, 0.10);
checkRate('CGT higher (Upper_CGT_rate)',      C.capitalGains.higherRate, 0.20);
checkRate('CGT residential lower',            C.capitalGains.basicRateResidential, 0.18);
checkRate('CGT residential higher',           C.capitalGains.higherRateResidential, 0.24);
checkRate('BADR rate (ER_CGT_rate)',          C.capitalGains.badrRate, 0.10);

// HICBC
check('HICBC lower (CBC_HR_threshold)',      C.hicbc.lowerThreshold, 60000);
check('HICBC upper (full charge)',           C.hicbc.upperThreshold, 80000);
if (Math.floor((C.hicbc.upperThreshold - C.hicbc.lowerThreshold) / C.hicbc.divisor) !== 100) {
  console.error(`  ✗ HICBC divisor ${C.hicbc.divisor}: does not reach 100% charge at £80,000`);
  failures++;
}

// Student loans
check('SL Plan 1 (SL_limit1)',   C.studentLoans.plan1.threshold, 24930);
check('SL Plan 2 (SL_limit2)',   C.studentLoans.plan2.threshold, 27295);
check('SL Plan 4 (SL_limit4)',   C.studentLoans.plan4.threshold, 31395);
check('SL Postgrad (PGL_limit)', C.studentLoans.postgrad.threshold, 21000);
checkRate('SL rate (Sloan_rate)',    C.studentLoans.plan1.rate, 0.09);
checkRate('PGL rate (PGL_rate)',     C.studentLoans.postgrad.rate, 0.06);

if (failures > 0) {
  console.error(`\nHMRC reference check FAILED: ${failures} mismatch(es).`);
  process.exit(1);
}
console.log('✓ CONFIG_2025_26 matches the HMRC 2025-26 reference table.');
