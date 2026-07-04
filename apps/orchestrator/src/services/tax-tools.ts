// ─────────────────────────────────────────────────────────────────────────────
// Agent-Computer Interface (ACI) for the Self Assessment filing agent.
//
// Design follows Anthropic's "Writing effective tools for agents":
//   - a small set of consolidated, high-impact tools (not thin CRUD wrappers)
//   - tools return high-signal, human-readable context (£, not pence)
//   - poka-yoke via the return-model Zod schemas
//   - helpful, actionable error strings (surfaced to the model as is_error)
//
// The agent uses these to OWN the return (record data) and to quote VERIFIED
// figures (compute_return). Because figures arrive as structured tool output,
// the model never needs to invent them — replacing the old prose censor.
// ─────────────────────────────────────────────────────────────────────────────

import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS } from '@uk-sa-app/tax-config';
import {
  Return,
  SA102Schema,
  ForeignIncomeItemSchema,
  SA109Schema,
} from '@uk-sa-app/return-model';

const gbp = (pence: number) =>
  `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const toPence = (pounds: number) => Math.round(pounds * 100);

export interface ToolContext {
  returnObj: Return;
}

export interface ToolResult {
  content: string;   // high-signal, human-readable context for the model
  isError?: boolean;
  mutated?: boolean; // true if the return was changed (caller persists)
}

// ─── Tool definitions (model-agnostic JSON-schema shape) ─────────────────────
// Descriptions are prompt-engineered: written like a docstring for a new hire,
// stating £ convention, when to call, and boundaries with other tools.

export const TAX_TOOL_DEFINITIONS = [
  {
    name: 'get_return_context',
    description:
      'Returns a readable snapshot of what has been captured on this return so far, plus the gaps still outstanding. Call this at the start of a turn when you are unsure what is already recorded, instead of re-asking the user.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'record_employment',
    description:
      'Records one employment (an SA102 job). Amounts are in POUNDS (£) — do not convert to pence, the tool does that. Call immediately when the user gives employer + pay; do not ask them to confirm first. Calling again with the same employerName replaces that job.',
    parameters: {
      type: 'object',
      properties: {
        employerName: { type: 'string', description: 'Employer name, e.g. "Acme UK Ltd"' },
        employerRef: { type: 'string', description: 'PAYE reference if known, e.g. "120/A4590"' },
        grossPay: { type: 'number', description: 'Gross pay in POUNDS (£)' },
        taxDeducted: { type: 'number', description: 'PAYE tax deducted in POUNDS (£)' },
      },
      required: ['employerName', 'grossPay', 'taxDeducted'],
    },
  },
  {
    name: 'record_foreign_income',
    description:
      'Records one foreign income item (SA106). Amounts in POUNDS (£). Use ISO 3-letter country codes (e.g. IND, USA). incomeType is one of savings, dividends, employment, property, other. Set treatyRateLimit as a fraction (0.15 for a 15% treaty cap) when a double-tax treaty caps the foreign rate.',
    parameters: {
      type: 'object',
      properties: {
        countryCode: { type: 'string', description: 'ISO 3166-1 alpha-3, e.g. "IND"' },
        incomeType: { type: 'string', enum: ['savings', 'dividends', 'employment', 'property', 'other'] },
        grossAmount: { type: 'number', description: 'Gross foreign income in POUNDS (£)' },
        foreignTaxPaid: { type: 'number', description: 'Foreign tax already paid, in POUNDS (£)' },
        treatyRateLimit: { type: 'number', description: 'Treaty rate cap as a fraction 0-1, e.g. 0.15' },
        claimFtcr: { type: 'boolean', description: 'Whether to claim Foreign Tax Credit Relief (default true)' },
      },
      required: ['countryCode', 'incomeType', 'grossAmount'],
    },
  },
  {
    name: 'record_residence',
    description:
      'Records residence & domicile (SA109) for the return. daysInUk drives the Statutory Residence Test. Set figRegimeElected when the client elects the Foreign Income & Gains regime. Call run_srt first if the residence status is not yet known.',
    parameters: {
      type: 'object',
      properties: {
        daysInUk: { type: 'number', description: 'Days spent in the UK in the tax year' },
        srtResult: { type: 'string', enum: ['resident', 'non_resident', 'split_year'] },
        domicileStatus: { type: 'string', enum: ['uk_domiciled', 'foreign_domiciled'] },
        figRegimeElected: { type: 'boolean', description: 'FIG regime elected (default false)' },
        overseasWorkdayReliefClaimed: { type: 'boolean', description: 'OWR claimed (default false)' },
      },
      required: ['daysInUk', 'srtResult', 'domicileStatus'],
    },
  },
  {
    name: 'record_reliefs',
    description:
      'Records reliefs on the SA100. Amounts in POUNDS (£). giftAidGrossedUp is the grossed-up Gift Aid figure. Only include fields the user mentioned; omitted fields are left unchanged.',
    parameters: {
      type: 'object',
      properties: {
        giftAidGrossedUp: { type: 'number', description: 'Grossed-up Gift Aid in POUNDS (£)' },
        relievablePensionContributions: { type: 'number', description: 'Pension contributions in POUNDS (£)' },
        blindPersonsAllowance: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'run_srt',
    description:
      'Runs a simplified Statutory Residence Test day-count check and returns the likely residence status with the reason. Use this to help determine residence before recording it. Does not mutate the return.',
    parameters: {
      type: 'object',
      properties: {
        daysInUk: { type: 'number', description: 'Days spent in the UK in the tax year' },
      },
      required: ['daysInUk'],
    },
  },
  {
    name: 'compute_return',
    description:
      'Runs the deterministic HMRC calculation engine on everything recorded so far and returns the verified figures (income tax, personal allowance, band breakdown, balancing payment). ALWAYS use these exact returned figures when telling the user any monetary amount — never estimate tax yourself.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'validate_return',
    description:
      'Checks whether the return is complete enough to submit and flags blocking issues or HMRC online-filing exclusions. Call before declaring/submitting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
] as const;

// ─── Executor ────────────────────────────────────────────────────────────────
// Applies a tool call against the current return. Mutations are validated
// through the return-model Zod schemas, so malformed input yields a helpful
// error the model can recover from — rather than corrupting the return.

export function executeTaxTool(
  name: string,
  args: any,
  ctx: ToolContext,
): ToolResult {
  const r = ctx.returnObj;
  const year = r.taxYear && CONFIGS[r.taxYear] ? r.taxYear : Object.keys(CONFIGS).sort().reverse()[0];
  const config = getConfig(year);

  try {
    switch (name) {
      case 'get_return_context':
        return { content: describeReturn(r) };

      case 'record_employment': {
        const job = SA102Schema.parse({
          employerName: args.employerName,
          employerRef: args.employerRef,
          grossPay: toPence(args.grossPay),
          taxDeducted: toPence(args.taxDeducted),
        });
        r.sa102 = (r.sa102 || []).filter(j => j.employerName !== job.employerName);
        r.sa102.push(job);
        const total = r.sa102.reduce((a, j) => a + j.grossPay, 0);
        return {
          mutated: true,
          content: `Recorded employment "${job.employerName}": gross pay ${gbp(job.grossPay)}, PAYE tax ${gbp(job.taxDeducted)}. Total employment income now ${gbp(total)} across ${r.sa102.length} job(s).`,
        };
      }

      case 'record_foreign_income': {
        const item = ForeignIncomeItemSchema.parse({
          countryCode: String(args.countryCode).toUpperCase(),
          incomeType: args.incomeType,
          grossAmount: toPence(args.grossAmount),
          foreignTaxPaid: toPence(args.foreignTaxPaid || 0),
          taxTreatyRateLimit: args.treatyRateLimit,
          claimFtcr: args.claimFtcr ?? true,
        });
        if (!r.sa106) r.sa106 = { foreignIncome: [], remittanceBasis: { claimRemittanceBasis: false, remittedAmount: 0, remittanceChargePaid: 0 } };
        r.sa106.foreignIncome.push(item);
        const ftcr = item.claimFtcr
          ? ` FTCR will be claimed${item.taxTreatyRateLimit ? ` (treaty cap ${(item.taxTreatyRateLimit * 100).toFixed(0)}%)` : ''}.`
          : '';
        return {
          mutated: true,
          content: `Recorded ${item.countryCode} foreign ${item.incomeType}: ${gbp(item.grossAmount)} gross, ${gbp(item.foreignTaxPaid)} foreign tax paid.${ftcr}`,
        };
      }

      case 'record_residence': {
        const res = SA109Schema.parse({
          residenceStatus: {
            daysInUk: args.daysInUk,
            srtResult: args.srtResult,
            domicileStatus: args.domicileStatus,
            figRegimeElected: args.figRegimeElected ?? false,
            overseasWorkdayReliefClaimed: args.overseasWorkdayReliefClaimed ?? false,
          },
        });
        r.sa109 = res;
        const s = res.residenceStatus;
        return {
          mutated: true,
          content: `Recorded residence: ${s.daysInUk} days in UK, status ${s.srtResult}, ${s.domicileStatus}${s.figRegimeElected ? ', FIG regime elected' : ''}.`,
        };
      }

      case 'record_reliefs': {
        const reliefs = r.sa100.reliefs;
        if (args.giftAidGrossedUp != null) reliefs.giftAidGrossedUp = toPence(args.giftAidGrossedUp);
        if (args.relievablePensionContributions != null) reliefs.relievablePensionContributions = toPence(args.relievablePensionContributions);
        if (args.blindPersonsAllowance != null) reliefs.blindPersonsAllowance = args.blindPersonsAllowance;
        return {
          mutated: true,
          content: `Recorded reliefs: Gift Aid ${gbp(reliefs.giftAidGrossedUp)}, pension ${gbp(reliefs.relievablePensionContributions)}${reliefs.blindPersonsAllowance ? ', Blind Person\u2019s Allowance' : ''}.`,
        };
      }

      case 'run_srt': {
        const d = Number(args.daysInUk);
        let status = 'inconclusive — depends on ties test';
        if (d < 16) status = 'non_resident (fewer than 16 days)';
        else if (d >= 183) status = 'resident (183 days or more — automatic UK test)';
        else if (d < 46) status = 'likely non_resident (arriver, under 46 days)';
        return {
          content: `SRT day-count for ${d} days: ${status}. Note: this is a day-count heuristic; the full SRT also considers automatic overseas/UK tests and sufficient-ties. Confirm before recording.`,
        };
      }

      case 'compute_return': {
        const calc = computeFullReturn(r, config);
        return { content: describeComputation(calc, r, year) };
      }

      case 'validate_return':
        return { content: validateReturn(r) };

      default:
        return { isError: true, content: `Unknown tool "${name}".` };
    }
  } catch (err: any) {
    // Poka-yoke: return an actionable message the model can recover from.
    const msg = err?.errors ? JSON.stringify(err.errors) : (err?.message || String(err));
    return { isError: true, content: `Could not apply ${name}: ${msg}. Check the field values and try again.` };
  }
}

// ─── Readable context builders ───────────────────────────────────────────────

export function describeReturn(r: Return): string {
  const lines: string[] = [`Return ${r.taxYear} — status: ${r.status}.`];

  if (r.sa102?.length) {
    const total = r.sa102.reduce((a, j) => a + j.grossPay, 0);
    lines.push(`Employment: ${r.sa102.length} job(s), total gross ${gbp(total)}.`);
  } else lines.push('Employment: none recorded.');

  if (r.sa106?.foreignIncome?.length) {
    lines.push(`Foreign income: ${r.sa106.foreignIncome.length} item(s) — ${r.sa106.foreignIncome.map(i => `${i.countryCode} ${i.incomeType} ${gbp(i.grossAmount)}`).join('; ')}.`);
  } else lines.push('Foreign income: none recorded.');

  if (r.sa109) {
    const s = r.sa109.residenceStatus;
    lines.push(`Residence: ${s.daysInUk} days, ${s.srtResult}, ${s.domicileStatus}${s.figRegimeElected ? ', FIG elected' : ''}.`);
  } else lines.push('Residence (SA109): not yet recorded.');

  const rl = r.sa100.reliefs;
  if (rl.giftAidGrossedUp || rl.relievablePensionContributions) {
    lines.push(`Reliefs: Gift Aid ${gbp(rl.giftAidGrossedUp)}, pension ${gbp(rl.relievablePensionContributions)}.`);
  } else lines.push('Reliefs: none recorded.');

  return lines.join('\n');
}

export function describeComputation(calc: any, r: Return, year: string): string {
  const it = calc?.incomeTax || {};
  const lines: string[] = [`Verified computation for ${year} (from the calculation engine):`];
  if (it.personalAllowance != null) lines.push(`- Personal allowance: ${gbp(it.personalAllowance)}`);
  if (it.incomeTaxTotal != null) lines.push(`- Total income tax: ${gbp(it.incomeTaxTotal)}`);

  const bands = it.allocatedBands || [];
  for (const b of bands) {
    if (b.taxCharged) lines.push(`    · ${b.name} @ ${(b.rate * 100).toFixed(1)}%: ${gbp(b.taxCharged)}`);
  }
  if (calc?.balancingPayment != null) {
    const bp = calc.balancingPayment;
    lines.push(`- Balancing payment ${bp >= 0 ? 'due' : 'refund'}: ${gbp(Math.abs(bp))}`);
  }
  if (calc?.figRegimeElected) lines.push('- FIG regime applied.');
  lines.push('Quote these exact figures to the user; do not recalculate or round them yourself.');
  return lines.join('\n');
}

export function validateReturn(r: Return): string {
  const issues: string[] = [];
  if (!r.sa102?.length && !r.sa106?.foreignIncome?.length) issues.push('No income recorded (employment or foreign).');
  if (!r.sa109) issues.push('Residence status (SA109) not recorded — required for foreign-national returns.');
  if (r.sa106?.foreignIncome?.length && !r.sa109) issues.push('Foreign income present but residence not established.');
  if (!r.taxYear) issues.push('Tax year not set.');

  if (!issues.length) return 'Validation passed: the return has the minimum data required to proceed to review/declaration.';
  return `Validation found ${issues.length} blocking issue(s):\n` + issues.map(i => `- ${i}`).join('\n');
}
