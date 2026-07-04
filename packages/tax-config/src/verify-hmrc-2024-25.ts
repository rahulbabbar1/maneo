/**
 * HMRC reference check for 2024-25.
 *
 * Every constant below is transcribed from HMRC's official test tool
 * "MTR-Tester-2024-25 v2.4.1", sheet 'data' (the authoritative rates/thresholds
 * table). This script asserts CONFIG_2024_25 matches it, so a future accidental
 * edit to a rate or threshold fails CI instead of silently mis-filing tax.
 *
 * Values on the HMRC sheet are in pounds; config is in pence, so we multiply by
 * 100 here. Run after build:  node dist/verify-hmrc-2024-25.js
 */
import { CONFIG_2024_25 as C } from './index.js';

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

console.log('Verifying CONFIG_2024_25 against HMRC MTR-Tester-2024-25 v2.4.1 (data sheet)...');

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

// rUK income tax bands: basic band width 37,700 (BR_band); additional-rate
// threshold 125,140 (AHR_band).
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

// Capital gains
check('CGT annual exempt (CG_exempt)',       C.capitalGains.annualExemptAmount, 3000);
checkRate('CGT lower (Lower_CGT_rate)',       C.capitalGains.basicRate, 0.10);
checkRate('CGT higher (Upper_CGT_rate)',      C.capitalGains.higherRate, 0.20);
checkRate('CGT residential lower',            C.capitalGains.basicRateResidential, 0.18);
checkRate('CGT residential higher',           C.capitalGains.higherRateResidential, 0.24);
checkRate('BADR rate (ER_CGT_rate)',          C.capitalGains.badrRate, 0.10);

// HICBC: threshold £60,000, full charge at £80,000 (1% per £200 → divisor £200)
check('HICBC lower (CBC_HR_threshold)',      C.hicbc.lowerThreshold, 60000);
check('HICBC upper (full charge)',           C.hicbc.upperThreshold, 80000);
if (Math.floor((C.hicbc.upperThreshold - C.hicbc.lowerThreshold) / C.hicbc.divisor) !== 100) {
  console.error(`  ✗ HICBC divisor ${C.hicbc.divisor}: does not reach 100% charge at £80,000`);
  failures++;
}

// Student loans
check('SL Plan 1 (SL_limit1)',   C.studentLoans.plan1.threshold, 24990);
check('SL Plan 2 (SL_limit2)',   C.studentLoans.plan2.threshold, 27295);
check('SL Plan 4 (SL_limit4)',   C.studentLoans.plan4.threshold, 31395);
check('SL Postgrad (PGL_limit)', C.studentLoans.postgrad.threshold, 21000);
checkRate('SL rate (Sloan_rate)',    C.studentLoans.plan1.rate, 0.09);
checkRate('PGL rate (PGL_rate)',     C.studentLoans.postgrad.rate, 0.06);

if (failures > 0) {
  console.error(`\nHMRC reference check FAILED: ${failures} mismatch(es).`);
  process.exit(1);
}
console.log('✓ CONFIG_2024_25 matches the HMRC 2024-25 reference table.');
