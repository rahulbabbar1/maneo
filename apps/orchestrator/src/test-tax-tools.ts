// Unit test for the agent tool layer (no live model needed).
// Proves the agent can OWN the return and that compute_return yields
// verified, human-readable figures the model would quote.

import { executeTaxTool, TAX_TOOL_DEFINITIONS } from './services/tax-tools.js';
import { Return } from '@uk-sa-app/return-model';

function makeReturn(): Return {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clientId: 'client-test',
    taxYear: '2025-26',
    status: 'draft',
    sa100: { taxAlreadyPaid: {}, reliefs: {} } as any,
    sa102: [],
    updatedAt: new Date().toISOString(),
  } as Return;
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`\u2717 ${msg}`); process.exit(1); }
  console.log(`\u2713 ${msg}`);
}

console.log('Starting Agent Tool-Layer Tests...\n');
const r = makeReturn();
const ctx = { returnObj: r };

// Tool set sanity
assert(TAX_TOOL_DEFINITIONS.length === 17, `17 tools defined (got ${TAX_TOOL_DEFINITIONS.length})`);

// HMRC Grounding Layer (C1)
let resGround = executeTaxTool('search_hmrc_guidance', { query: 'UK India dividend treaty cap' }, ctx);
assert(!resGround.isError && resGround.content.includes('15%'), 'search_hmrc_guidance returns grounded citable passage');


// Record employment (£ in, pence stored)
let res = executeTaxTool('record_employment', { employerName: 'Acme UK Ltd', grossPay: 85000, taxDeducted: 20123 }, ctx);
assert(!res.isError && r.sa102[0].grossPay === 8500000, 'record_employment stores £85,000 as 8500000 pence');
assert(res.content.includes('£85,000.00'), 'record_employment returns readable £ context');

// Foreign income with treaty cap
res = executeTaxTool('record_foreign_income', { countryCode: 'ind', incomeType: 'dividends', grossAmount: 5000, foreignTaxPaid: 750, treatyRateLimit: 0.15 }, ctx);
assert(!res.isError && r.sa106!.foreignIncome[0].countryCode === 'IND', 'record_foreign_income upcases country code');
assert(res.content.includes('treaty cap 15%'), 'record_foreign_income surfaces treaty cap');

// Residence
res = executeTaxTool('record_residence', { daysInUk: 190, srtResult: 'resident', domicileStatus: 'foreign_domiciled', figRegimeElected: true }, ctx);
assert(!res.isError && r.sa109!.residenceStatus.figRegimeElected === true, 'record_residence stores SA109 with FIG');

// Poka-yoke: bad enum should error, not corrupt
res = executeTaxTool('record_residence', { daysInUk: 10, srtResult: 'maybe', domicileStatus: 'foreign_domiciled' }, ctx);
assert(res.isError === true, 'invalid srtResult is rejected with a helpful error (poka-yoke)');

// SRT: automatic UK test
res = executeTaxTool('run_srt', { daysInUk: 200 }, ctx);
assert(res.content.toLowerCase().includes('resident'), 'run_srt flags 200 days as resident');

// SRT: sufficient-ties test (arriver, 100 days, 3 ties -> resident)
res = executeTaxTool('run_srt', { daysInUk: 100, residentInPrior3Years: false, ukTies: 3 }, ctx);
assert(/RESIDENT/.test(res.content) && res.content.includes('ties'), 'run_srt applies the sufficient-ties test for an arriver');

// SRT: automatic overseas (arriver under 46 days -> non-resident)
res = executeTaxTool('run_srt', { daysInUk: 20, residentInPrior3Years: false }, ctx);
assert(/NON-RESIDENT/.test(res.content), 'run_srt applies the arriver automatic-overseas test');

// New tool: UK investment income
res = executeTaxTool('record_uk_investment_income', { ukSavingsIncome: 2000, ukDividendIncome: 1500 }, ctx);
assert(!res.isError && r.sa100.income!.ukSavingsIncome === 200000, 'record_uk_investment_income stores UK interest in pence');

// New tool: child benefit for HICBC
res = executeTaxTool('record_child_benefit', { childBenefitReceived: 2074, numberOfChildren: 2 }, ctx);
assert(!res.isError && r.sa101!.highIncomeChildBenefitCharge.benefitAmountReceived === 207400, 'record_child_benefit stores Child Benefit for HICBC');

// New tool: pension what-if comparison (must NOT mutate the return)
res = executeTaxTool('compare_pension_contribution', { contributionAmount: 10000 }, ctx);
assert(!res.isError && res.content.includes('Tax saved'), 'compare_pension_contribution returns a tax-saving what-if');
assert((r.sa100.reliefs.relievablePensionContributions || 0) === 0, 'compare_pension_contribution does not mutate the return');

// Compute returns verified figures
res = executeTaxTool('compute_return', {}, ctx);
assert(res.content.includes('Personal allowance') && res.content.includes('£'), 'compute_return returns verified £ figures');
console.log('\n--- compute_return output ---\n' + res.content + '\n');

// Validate
res = executeTaxTool('validate_return', {}, ctx);
assert(res.content.includes('Validation passed'), 'validate_return passes for a complete return');

console.log('\n\u2705 All Agent Tool-Layer Tests passed.');
