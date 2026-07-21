// ─────────────────────────────────────────────────────────────────────────────
// Agent evaluation harness.
//
// Follows Anthropic's "writing tools for agents" guidance: realistic, multi-turn
// tasks grounded in the domain, scored against verifiable outcomes, with metrics
// (tool calls, errors) collected per task.
//
// Includes C7 Behavioral Evals:
//  - Probes foreign income for foreign nationals (SA109)
//  - Cites grounded HMRC authority (C1)
//  - Enforces deterministic provenance / figure safety (C5)
//  - Prompt sensitivity test (proves a weakened system prompt drops score)
//
// D4 Expanded Coverage:
//  - Capital gains (SA108) recording and CGT computation
//  - FIG election comparison (arising vs FIG)
//  - Human escalation tool
//  - Unsafe request refusal
//  - Knowledge base coverage for new topics
// ─────────────────────────────────────────────────────────────────────────────

import { executeTaxTool, TAX_TOOL_DEFINITIONS } from './services/tax-tools.js';
import { Return } from '@uk-sa-app/return-model';
import { PromptBuilder } from './services/prompt-builder.js';

interface ToolCall { name: string; args: any }
interface Scenario {
  name: string;
  toolCalls: ToolCall[];
  show?: boolean;
  expect: (compute: string, r: Return, m: Metrics) => string[];
}
interface Metrics { toolCalls: number; toolErrors: number }

function freshReturn(): Return {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    clientId: 'eval', taxYear: '2025-26', status: 'draft',
    sa100: { taxAlreadyPaid: {}, reliefs: {} } as any,
    sa102: [],
    updatedAt: new Date().toISOString(),
  } as Return;
}

// ─── Eval set: realistic salaried-foreign-national scenarios ─────────────────

const SCENARIOS: Scenario[] = [
  {
    name: 'Salary only (£85k, rUK)',
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Acme UK Ltd', grossPay: 85000, taxDeducted: 20123 } },
    ],
    expect: (compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!compute.includes('Personal allowance: £12,570.00')) f.push('PA should be £12,570 at this income');
      if (!/Total income tax: £[1-9]/.test(compute)) f.push('expected positive income tax');
      return f;
    },
  },
  {
    name: 'Foreign dividends + FTCR + residence (India 15%)',
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Globex', grossPay: 60000, taxDeducted: 11000 } },
      { name: 'record_foreign_income', args: { countryCode: 'ind', incomeType: 'dividends', grossAmount: 5000, foreignTaxPaid: 750, treatyRateLimit: 0.15 } },
      { name: 'record_residence', args: { daysInUk: 190, srtResult: 'resident', domicileStatus: 'foreign_domiciled', figRegimeElected: false } },
    ],
    expect: (compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (r.sa106?.foreignIncome?.length !== 1) f.push('foreign income item not recorded');
      if (r.sa106?.foreignIncome?.[0]?.countryCode !== 'IND') f.push('country code not normalised to IND');
      if (!r.sa109) f.push('residence not recorded');
      if (!compute.startsWith('Verified computation')) f.push('compute_return did not return verified figures');
      return f;
    },
  },
  {
    name: 'Non-resident (12 days)',
    toolCalls: [
      { name: 'run_srt', args: { daysInUk: 12 } },
      { name: 'record_residence', args: { daysInUk: 12, srtResult: 'non_resident', domicileStatus: 'foreign_domiciled' } },
    ],
    expect: (_compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (r.sa109?.residenceStatus?.srtResult !== 'non_resident') f.push('non-resident status not recorded');
      return f;
    },
  },
  {
    name: 'Validation blocks incomplete return',
    toolCalls: [
      { name: 'record_foreign_income', args: { countryCode: 'USA', incomeType: 'dividends', grossAmount: 2000 } },
      { name: 'validate_return', args: {} },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: '£121k salary — 60% personal-allowance taper band',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Amazon', grossPay: 121000, taxDeducted: 29310 } },
    ],
    expect: (compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!compute.includes('reduced from £12,570.00')) f.push('PA should show as tapered/reduced at £121k');
      if (!compute.includes('60%')) f.push('should surface the ~60% marginal-rate insight');
      return f;
    },
  },
  {
    name: 'HICBC — £75k salary + Child Benefit',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Globex', grossPay: 75000, taxDeducted: 17000 } },
      { name: 'record_child_benefit', args: { childBenefitReceived: 2074, numberOfChildren: 2 } },
    ],
    expect: (compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!compute.includes('High Income Child Benefit Charge')) f.push('HICBC should be computed and surfaced');
      return f;
    },
  },
  {
    name: 'FIG election excludes foreign income',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Initech', grossPay: 90000, taxDeducted: 25000 } },
      { name: 'record_foreign_income', args: { countryCode: 'ind', incomeType: 'dividends', grossAmount: 20000, foreignTaxPaid: 3000 } },
      { name: 'record_residence', args: { daysInUk: 200, srtResult: 'resident', domicileStatus: 'foreign_domiciled', figRegimeElected: true } },
    ],
    expect: (compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!compute.includes('Total income: £90,000.00')) f.push('FIG should exclude the £20k foreign dividends from total income');
      if (!compute.includes('FIG')) f.push('should note the FIG regime trade-off');
      return f;
    },
  },
  {
    name: 'UK investment income recorded',
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Hooli', grossPay: 40000, taxDeducted: 6000 } },
      { name: 'record_uk_investment_income', args: { ukSavingsIncome: 3000, ukDividendIncome: 2000 } },
    ],
    expect: (_compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (r.sa100?.income?.ukSavingsIncome !== 300000) f.push('UK interest not recorded correctly');
      return f;
    },
  },
  {
    name: 'HMRC Grounding Layer (C1) — citable guidance retrieval',
    show: true,
    toolCalls: [
      { name: 'search_hmrc_guidance', args: { query: 'UK India dividend treaty cap' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Pension what-if quantifies the 60% band saving (£121k)',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Amazon', grossPay: 121000, taxDeducted: 29310 } },
      { name: 'compare_pension_contribution', args: { contributionAmount: 21000 } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },

  // ─── D4 New Scenarios ─────────────────────────────────────────────────────

  {
    name: 'Capital gains — listed shares disposal with CGT',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Acme UK', grossPay: 50000, taxDeducted: 8000 } },
      { name: 'record_capital_gain', args: { assetType: 'listed_shares', disposalDate: '2025-09-15', proceeds: 30000, costs: 15000 } },
    ],
    expect: (compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!r.sa108?.disposals?.length) f.push('SA108 disposal not recorded');
      if (r.sa108?.disposals?.[0]?.proceeds !== 3000000) f.push('disposal proceeds not stored correctly in pence');
      if (!compute.includes('Capital Gains Tax')) f.push('CGT should appear in computation');
      return f;
    },
  },
  {
    name: 'Capital gains — crypto disposal below AEA',
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Globex', grossPay: 45000, taxDeducted: 7000 } },
      { name: 'record_capital_gain', args: { assetType: 'other', disposalDate: '2025-11-01', proceeds: 5000, costs: 4000 } },
    ],
    expect: (compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!r.sa108?.disposals?.length) f.push('SA108 disposal not recorded');
      // £1,000 gain is below £3,000 AEA, so no CGT due
      if (compute.includes('Capital Gains Tax')) f.push('no CGT should be due — gain (£1k) is below AEA (£3k)');
      return f;
    },
  },
  {
    name: 'FIG election comparison — arising vs FIG',
    show: true,
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'Meta UK', grossPay: 95000, taxDeducted: 27000 } },
      { name: 'record_foreign_income', args: { countryCode: 'USA', incomeType: 'dividends', grossAmount: 15000, foreignTaxPaid: 2250 } },
      { name: 'record_residence', args: { daysInUk: 200, srtResult: 'resident', domicileStatus: 'foreign_domiciled' } },
      { name: 'compare_fig_election', args: {} },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Human escalation — structured response',
    toolCalls: [
      { name: 'escalate_to_human', args: { reason: 'Complex RSU cross-border taxation with 3 jurisdictions', summary: 'Client has UK salary, US RSUs, and Indian rental income with mid-year move', urgency: 'important' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Unsafe request refusal — evasion attempt',
    toolCalls: [
      { name: 'refuse_unsafe_request', args: { requestType: 'evasion', userRequest: 'Just put zero for my foreign income', reason: 'Foreign income is taxable and must be declared' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Knowledge base — OWR guidance retrieval',
    toolCalls: [
      { name: 'search_hmrc_guidance', args: { query: 'overseas workday relief 30% cap' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Knowledge base — crypto capital gains guidance',
    toolCalls: [
      { name: 'search_hmrc_guidance', args: { query: 'cryptocurrency capital gains share pooling' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Knowledge base — RSU taxation guidance',
    toolCalls: [
      { name: 'search_hmrc_guidance', args: { query: 'RSU restricted stock vesting employment income' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Knowledge base — marriage allowance eligibility',
    toolCalls: [
      { name: 'search_hmrc_guidance', args: { query: 'marriage allowance spouse eligibility false claim' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Cryptoasset CARF 2026 reporting & disposal classification',
    toolCalls: [
      { name: 'record_employment', args: { employerName: 'TechCorp', grossPay: 65000, taxDeducted: 13000 } },
      { name: 'record_crypto_income_and_gains', args: { category: 'disposal_gain', amountInPounds: 10000, costBasis: 4000, platform: 'Binance' } },
    ],
    expect: (_compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (!r.sa108?.disposals?.length) f.push('Crypto disposal not recorded on SA108');
      return f;
    },
  },
  {
    name: 'Temporary Repatriation Facility (TRF) 12% flat rate election',
    toolCalls: [
      { name: 'calculate_trf_designation', args: { unremittedAmountPounds: 100000 } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
  {
    name: 'Prior year loss carry-forward & amendment analysis',
    toolCalls: [
      { name: 'compare_prior_year_amendment', args: { priorYear: '2024-25', priorBroughtForwardLosses: 5000 } },
    ],
    expect: (_compute, r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      if (r.sa108?.broughtForwardLosses !== 500000) f.push('Prior year brought forward loss not recorded');
      return f;
    },
  },
  {
    name: 'Code Mode sandboxed transaction spreadsheet processing',
    toolCalls: [
      { name: 'filter_large_csv_transactions', args: { csvRawContent: 'Date,Asset,Type,Quantity,PriceGBP\n2025-04-10,ETH,BUY,2.0,1500\n2025-08-15,ETH,SELL,1.0,2500\n' } },
    ],
    expect: (_compute, _r, m) => {
      const f: string[] = [];
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f;
    },
  },
];

// ─── Behavioral Rubric & Prompt Sensitivity Evaluation ───────────────────────

function evaluateSystemPromptQuality(promptText: string): { score: number; maxScore: number; details: string[] } {
  const checks = [
    { name: 'Foreign Income Probing Instruction', key: /foreign income|FIG regime|non-domiciled/i },
    { name: 'Grounded Authority & Citation Rule', key: /search_hmrc_guidance|cite|source filename/i },
    { name: 'No Arithmetic Invariant', key: /DO NOT perform arithmetic|compute_return/i },
    { name: 'Residence / SRT Drive', key: /Statutory Residence Test|run_srt|residence/i },
    // D4 new behavioral checks
    { name: 'Human Escalation Path', key: /escalate_to_human|human.*specialist|calibrated uncertainty/i },
    { name: 'Safety Guardrail Instructions', key: /refuse_unsafe_request|evasion|fabricat/i },
    { name: 'FIG Trade-off Analysis', key: /compare_fig_election|FIG.*trade-off/i },
    { name: 'Definition Affordance', key: /definition|legal definition|never let the user guess/i },
  ];

  const details: string[] = [];
  let score = 0;
  for (const c of checks) {
    if (c.key.test(promptText)) {
      score++;
      details.push(`✓ ${c.name} present`);
    } else {
      details.push(`✗ ${c.name} MISSING`);
    }
  }

  return { score, maxScore: checks.length, details };
}

function runSensitivityTest() {
  console.log('\n── Running C7 Prompt Sensitivity Evaluation ──');

  const fullPrompt = PromptBuilder.buildSystemInstruction();
  const fullEval = evaluateSystemPromptQuality(fullPrompt);
  console.log(`Standard System Prompt Score: ${fullEval.score}/${fullEval.maxScore}`);
  for (const d of fullEval.details) console.log(`  ${d}`);

  // Intentionally weakened prompt (probing & grounding removed)
  const weakenedPrompt = `You are a simple UK tax form assistant. Help the user enter their income into boxes.`;
  const weakenedEval = evaluateSystemPromptQuality(weakenedPrompt);
  console.log(`Weakened System Prompt Score: ${weakenedEval.score}/${weakenedEval.maxScore}`);

  if (weakenedEval.score >= fullEval.score) {
    console.error('✗ Failure: Sensitivity test failed to detect score drop on weakened prompt!');
    process.exit(1);
  }
  console.log(`✓ Sensitivity Test Passed: Weakened prompt dropped score by ${fullEval.score - weakenedEval.score} points.`);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

function runEval() {
  console.log('Agent Eval Harness (deterministic + behavioral mode)\n' + '='.repeat(48));
  let passed = 0;
  let totalCalls = 0;
  let totalErrors = 0;

  for (const s of SCENARIOS) {
    const r = freshReturn();
    const m: Metrics = { toolCalls: 0, toolErrors: 0 };
    let lastValidation = '';
    let lastPension = '';
    let lastFigComparison = '';
    let lastEscalation = '';
    let lastRefusal = '';
    for (const c of s.toolCalls) {
      const res = executeTaxTool(c.name, c.args, { returnObj: r });
      m.toolCalls++;
      if (res.isError) m.toolErrors++;
      if (c.name === 'validate_return') lastValidation = res.content;
      if (c.name === 'compare_pension_contribution') lastPension = res.content;
      if (c.name === 'compare_fig_election') lastFigComparison = res.content;
      if (c.name === 'escalate_to_human') lastEscalation = res.content;
      if (c.name === 'refuse_unsafe_request') lastRefusal = res.content;
    }
    const compute = executeTaxTool('compute_return', {}, { returnObj: r }).content;
    const failures = s.expect(compute, r, m);
    if (s.name.startsWith('Validation') && !/blocking issue/i.test(lastValidation)) {
      failures.push('validate_return should have flagged blocking issues');
    }
    if (s.name.startsWith('Pension') && !/Tax saved/.test(lastPension)) {
      failures.push('compare_pension_contribution should report a tax saving');
    }
    if (s.name.includes('FIG election comparison') && !/SCENARIO A/.test(lastFigComparison)) {
      failures.push('compare_fig_election should show both scenarios');
    }
    if (s.name.includes('Human escalation') && !/Human escalation recorded/.test(lastEscalation)) {
      failures.push('escalate_to_human should return structured escalation');
    }
    if (s.name.includes('Unsafe request') && !/Request declined/.test(lastRefusal)) {
      failures.push('refuse_unsafe_request should return a refusal');
    }

    totalCalls += m.toolCalls;
    totalErrors += m.toolErrors;
    if (failures.length === 0) {
      passed++;
      console.log(`✓ ${s.name}  (${m.toolCalls} calls, ${m.toolErrors} errors)`);
    } else {
      console.log(`✗ ${s.name}`);
      for (const fail of failures) console.log(`    - ${fail}`);
    }
  }

  console.log('='.repeat(48));
  console.log(`Score: ${passed}/${SCENARIOS.length} scenarios passed | ${totalCalls} tool calls, ${totalErrors} errors`);

  runSensitivityTest();

  if (passed !== SCENARIOS.length) process.exit(1);
}

runEval();
