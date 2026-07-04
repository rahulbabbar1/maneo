// ─────────────────────────────────────────────────────────────────────────────
// Agent evaluation harness.
//
// Follows Anthropic's "writing tools for agents" guidance: realistic, multi-turn
// tasks grounded in the domain, scored against verifiable outcomes, with metrics
// (tool calls, errors) collected per task.
//
// Two modes:
//   • DETERMINISTIC (this file, runnable offline): each scenario declares the
//     tool calls an ideal agent would make; the harness executes them against
//     the real tool layer + engine and checks the resulting return/figures.
//     This catches regressions in the tool→engine→figures path.
//   • LIVE (TODO, needs Vertex creds): swap the scripted tool calls for the
//     model's own tool selection via GeminiAgent, and score the same outcomes.
//     The scenarios below are the eval set for both modes.
// ─────────────────────────────────────────────────────────────────────────────

import { executeTaxTool } from './services/tax-tools.js';
import { Return } from '@uk-sa-app/return-model';

interface ToolCall { name: string; args: any }
interface Scenario {
  name: string;
  toolCalls: ToolCall[];
  // Return a list of failure strings (empty = pass). Receives the final
  // compute_return text, the mutated return, and run metrics.
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
      // foreign income without residence should be flagged by validate_return.
      if (m.toolErrors) f.push(`unexpected tool errors: ${m.toolErrors}`);
      return f; // validation-content check happens in the runner (below)
    },
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

function runEval() {
  console.log('Agent Eval Harness (deterministic mode)\n' + '='.repeat(48));
  let passed = 0;
  let totalCalls = 0;
  let totalErrors = 0;

  for (const s of SCENARIOS) {
    const r = freshReturn();
    const m: Metrics = { toolCalls: 0, toolErrors: 0 };
    let lastValidation = '';
    for (const c of s.toolCalls) {
      const res = executeTaxTool(c.name, c.args, { returnObj: r });
      m.toolCalls++;
      if (res.isError) m.toolErrors++;
      if (c.name === 'validate_return') lastValidation = res.content;
    }
    const compute = executeTaxTool('compute_return', {}, { returnObj: r }).content;
    const failures = s.expect(compute, r, m);
    // Extra check for the validation scenario.
    if (s.name.startsWith('Validation') && !/blocking issue/i.test(lastValidation)) {
      failures.push('validate_return should have flagged blocking issues');
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
  if (passed !== SCENARIOS.length) process.exit(1);
}

runEval();
