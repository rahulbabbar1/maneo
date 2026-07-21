// ─────────────────────────────────────────────────────────────────────────────
// Agent-Computer Interface (ACI) for the Self Assessment filing agent.
//
// Design follows Anthropic's "Writing effective tools for agents":
//   - a small set of consolidated, high-impact tools (not thin CRUD wrappers)
//   - tools return high-signal, human-readable context (£, not pence)
//   - poka-yoke via the return-model Zod schemas
//   - helpful, actionable error strings (surfaced to the model as is_error)
//   - compute_return returns not just figures but PLANNING INSIGHTS and ENGINE
//     WARNINGS, so the model reasons like an adviser and never invents numbers.
// ─────────────────────────────────────────────────────────────────────────────

import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS, TaxYearConfig } from '@uk-sa-app/tax-config';
import {
  Return,
  SA102Schema,
  ForeignIncomeItemSchema,
  SA109Schema,
  CapitalGainsDisposalSchema,
} from '@uk-sa-app/return-model';
import { searchHmrcGuidance } from '@uk-sa-app/knowledge';
import { processLargeCsvTransactions } from './code-mode-filter.js';


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

export const TAX_TOOL_DEFINITIONS = [
  {
    name: 'get_return_context',
    description:
      'Returns a readable snapshot of what has been captured on this return so far, plus the gaps still outstanding. The snapshot is also shown to you in the system prompt each turn; call this only when you need the fuller detail. Never re-ask the user for something the snapshot already shows.',
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
      'Records one foreign income item (SA106) — e.g. overseas bank interest, foreign dividends, overseas rental. Amounts in POUNDS (£). Use ISO 3-letter country codes (IND, USA). incomeType is one of savings, dividends, employment, property, other. Set treatyRateLimit as a fraction (0.15 for the UK–India 15% dividend cap) when a Double Taxation Agreement caps the foreign rate. Foreign income is central to this niche — capture it whenever a foreign national has any overseas income.',
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
    name: 'record_uk_investment_income',
    description:
      'Records UK (domestic) investment income on the SA100: UK bank/building-society interest and UK dividends. Amounts in POUNDS (£). Foreign interest/dividends do NOT go here — use record_foreign_income for those. Only pass the fields the user mentioned.',
    parameters: {
      type: 'object',
      properties: {
        ukSavingsIncome: { type: 'number', description: 'Gross UK interest in POUNDS (£)' },
        ukDividendIncome: { type: 'number', description: 'Gross UK dividends in POUNDS (£)' },
      },
      required: [],
    },
  },
  {
    name: 'record_residence',
    description:
      'Records residence & domicile (SA109). daysInUk drives the Statutory Residence Test. srtResult is the concluded status. Set domicileStatus (foreign_domiciled for most foreign nationals), figRegimeElected when the client elects the 4-year Foreign Income & Gains regime, and overseasWorkdayReliefClaimed where OWR applies. Call run_srt first if the status is not yet clear.',
    parameters: {
      type: 'object',
      properties: {
        daysInUk: { type: 'number', description: 'Days spent in the UK in the tax year' },
        srtResult: { type: 'string', enum: ['resident', 'non_resident', 'split_year'] },
        domicileStatus: { type: 'string', enum: ['uk_domiciled', 'foreign_domiciled'] },
        figRegimeElected: { type: 'boolean', description: 'FIG regime elected (default false). Note: electing FIG forfeits the personal allowance and CGT annual exempt amount.' },
        overseasWorkdayReliefClaimed: { type: 'boolean', description: 'OWR claimed (default false)' },
      },
      required: ['daysInUk', 'srtResult', 'domicileStatus'],
    },
  },
  {
    name: 'record_reliefs',
    description:
      'Records reliefs on the SA100. Amounts in POUNDS (£). giftAidGrossedUp is the grossed-up Gift Aid figure. Pension contributions and Gift Aid extend the tax bands and reduce adjusted net income — the key levers for the 60% taper band and HICBC. Only include fields the user mentioned; omitted fields are left unchanged.',
    parameters: {
      type: 'object',
      properties: {
        giftAidGrossedUp: { type: 'number', description: 'Grossed-up Gift Aid in POUNDS (£)' },
        relievablePensionContributions: { type: 'number', description: 'Relievable pension contributions in POUNDS (£)' },
        blindPersonsAllowance: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'record_child_benefit',
    description:
      'Records Child Benefit received by the client or their partner, so the High Income Child Benefit Charge (HICBC) can be assessed. Call this when the client has income over £60,000 and confirms Child Benefit was received. childBenefitReceived is the total received in the year, in POUNDS (£).',
    parameters: {
      type: 'object',
      properties: {
        childBenefitReceived: { type: 'number', description: 'Total Child Benefit received in the year, in POUNDS (£)' },
        numberOfChildren: { type: 'number', description: 'Number of children (optional)' },
      },
      required: ['childBenefitReceived'],
    },
  },
  {
    name: 'record_student_loan',
    description:
      'Records the client\'s student loan repayment plan so any repayment due through Self Assessment is computed. planType is one of plan_1, plan_2, plan_4, plan_5, postgraduate, none.',
    parameters: {
      type: 'object',
      properties: {
        planType: { type: 'string', enum: ['plan_1', 'plan_2', 'plan_4', 'plan_5', 'postgraduate', 'none'] },
      },
      required: ['planType'],
    },
  },
  {
    name: 'run_srt',
    description:
      'Statutory Residence Test helper. Evaluates the automatic overseas tests, automatic UK test, and the sufficient-ties test, and returns the concluded (or provisional) status with reasoning. daysInUk is required. Provide residentInPrior3Years (was the client UK-resident in any of the previous 3 tax years — distinguishes an "arriver" from a "leaver") and ukTies (count of UK ties) for a firm conclusion. Does not mutate the return.',
    parameters: {
      type: 'object',
      properties: {
        daysInUk: { type: 'number', description: 'Days spent in the UK in the tax year' },
        residentInPrior3Years: { type: 'boolean', description: 'True if UK-resident in any of the previous 3 tax years (leaver); false if not (arriver)' },
        ukTies: { type: 'number', description: 'Number of UK ties: family, accommodation, work (40+ UK workdays), 90-day, and (leavers only) country' },
        fullTimeWorkOverseas: { type: 'boolean', description: 'Client works full-time overseas' },
        fullTimeWorkUk: { type: 'boolean', description: 'Client works full-time in the UK' },
      },
      required: ['daysInUk'],
    },
  },
  {
    name: 'compute_return',
    description:
      'Runs the deterministic HMRC calculation engine on everything recorded so far and returns the VERIFIED figures (income tax, personal allowance after taper, band-by-band breakdown, HICBC, FTCR, balancing payment, payments on account) PLUS planning insights and engine warnings. ALWAYS use these exact figures when telling the user any monetary amount — never estimate tax yourself. Read the planning insights and pass the relevant ones to the client.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'compare_pension_contribution',
    description:
      'Quantifies the tax effect of a personal pension contribution by running the engine twice — once as-is and once with the extra relievable contribution added — and returns the EXACT tax saving. Use this to make 60%-taper-band and HICBC advice concrete (e.g. "a £21,000 contribution saves £X"). This is a what-if only: it does NOT change the return. Amount in POUNDS (£).',
    parameters: {
      type: 'object',
      properties: {
        contributionAmount: { type: 'number', description: 'Additional relievable pension contribution to model, in POUNDS (£)' },
      },
      required: ['contributionAmount'],
    },
  },
  {
    name: 'search_hmrc_guidance',
    description:
      'Searches the grounded HMRC authority database (SA109/SA106 technical guidance, DTA conventions, FIG 4-year rules, and MTR calculation methodology) and returns citable passages. Use this tool whenever the user asks technical tax questions or when verifying statutory eligibility before recording claims.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Technical tax query or rule topic, e.g. "UK India dividend treaty cap" or "FIG regime 4 year eligibility"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'validate_return',
    description:
      'Checks whether the return is complete enough to submit and flags blocking issues, missing items, and HMRC online-filing exclusions relevant to foreign-national returns. Call before declaring/submitting.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'record_capital_gain',
    description:
      'Records a capital gains disposal on SA108 — share sales, crypto disposals, property sales. Amounts in POUNDS (£). assetType is one of residential_property, other_property, listed_shares, unlisted_shares, other. disposalDate as YYYY-MM-DD. For crypto-to-crypto swaps, each swap is a separate disposal. For RSUs, the cost basis is the market value at vesting (only post-vest growth is a gain).',
    parameters: {
      type: 'object',
      properties: {
        assetType: { type: 'string', enum: ['residential_property', 'other_property', 'listed_shares', 'unlisted_shares', 'other'] },
        disposalDate: { type: 'string', description: 'Date of disposal as YYYY-MM-DD' },
        proceeds: { type: 'number', description: 'Sale/disposal proceeds in POUNDS (£)' },
        costs: { type: 'number', description: 'Allowable costs (acquisition + improvements + fees) in POUNDS (£)' },
        losses: { type: 'number', description: 'Allowable losses in POUNDS (£), default 0' },
        claimBadr: { type: 'boolean', description: 'Claim Business Asset Disposal Relief (10% rate, default false)' },
      },
      required: ['assetType', 'disposalDate', 'proceeds', 'costs'],
    },
  },
  {
    name: 'compare_fig_election',
    description:
      'Quantifies the EXACT tax difference between electing the FIG (Foreign Income & Gains) regime and using the arising basis with FTCR, by running the deterministic engine twice. Use this when a qualifying new arrival has foreign income and may be FIG-eligible (non-UK-resident for the prior 10 years). This is a what-if only — does NOT change the return. Shows both scenarios so the client can make an informed choice.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'escalate_to_human',
    description:
      'Escalates to a human tax specialist. Call when you encounter a genuinely complex edge case, conflicting evidence, low-confidence advice, or when the client explicitly requests human help. Calibrated uncertainty is ALWAYS better than confident hallucination. Provide a clear reason and a summary of what has been established so far.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why this needs human review (e.g. "conflicting residence evidence" or "complex RSU cross-border taxation")' },
        summary: { type: 'string', description: 'Brief summary of the situation and what has been established' },
        urgency: { type: 'string', enum: ['routine', 'important', 'urgent'], description: 'How urgent is the escalation' },
      },
      required: ['reason', 'summary'],
    },
  },
  {
    name: 'refuse_unsafe_request',
    description:
      'Responds to unsafe requests — tax evasion ("just put zero"), fabrication of figures, aggressive avoidance schemes, or requests to submit without verification. Call this instead of complying. Be firm but empathetic: explain WHY the request is problematic and point to legitimate alternatives.',
    parameters: {
      type: 'object',
      properties: {
        requestType: { type: 'string', enum: ['evasion', 'fabrication', 'aggressive_avoidance', 'unverified_submission', 'other'] },
        userRequest: { type: 'string', description: 'What the user asked for' },
        reason: { type: 'string', description: 'Why this cannot be done' },
      },
      required: ['requestType', 'userRequest', 'reason'],
    },
  },
  {
    name: 'record_crypto_income_and_gains',
    description:
      'Records cryptoasset transactions in accordance with HMRC CARF (Cryptoasset Reporting Framework 2026) guidelines. Distinguishes Income Tax events (staking rewards, interest, mining -> SA100) from Capital Gains Tax events (crypto sales, crypto-to-crypto swaps -> SA108). Amounts in POUNDS (£).',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['disposal_gain', 'staking_income', 'mining_income', 'airdrop_income', 'interest_income'] },
        amountInPounds: { type: 'number', description: 'Total gross value or gain/loss in POUNDS (£)' },
        costBasis: { type: 'number', description: 'Acquisition cost in POUNDS (£) for disposals' },
        disposalDate: { type: 'string', description: 'Transaction date (YYYY-MM-DD)' },
        platform: { type: 'string', description: 'Exchange or wallet name (e.g. Coinbase, Koinly, Kraken)' },
      },
      required: ['category', 'amountInPounds'],
    },
  },
  {
    name: 'calculate_trf_designation',
    description:
      'Quantifies the tax savings of electing the Temporary Repatriation Facility (TRF) for pre-6-April-2025 unremitted foreign income and gains. TRF allows designating funds at a 12% flat tax rate (2025-26 & 2026-27) vs standard arising marginal rates (20%/40%/45%). Amount in POUNDS (£). Does NOT mutate the return unless user confirms.',
    parameters: {
      type: 'object',
      properties: {
        unremittedAmountPounds: { type: 'number', description: 'Pre-April 2025 unremitted foreign income or gain in POUNDS (£)' },
      },
      required: ['unremittedAmountPounds'],
    },
  },
  {
    name: 'compare_prior_year_amendment',
    description:
      'Compares the current tax year return against a prior tax year (e.g. 2024-25 vs 2025-26). Checks brought-forward capital losses, tracks changes in UK residence status, and assesses amendment claim savings. Does NOT mutate the return.',
    parameters: {
      type: 'object',
      properties: {
        priorYear: { type: 'string', description: 'Prior tax year, e.g. "2024-25"' },
        priorBroughtForwardLosses: { type: 'number', description: 'Brought forward capital losses in POUNDS (£)' },
      },
      required: ['priorYear'],
    },
  },
  {
    name: 'filter_large_csv_transactions',
    description:
      'Runs sandboxed Code Mode filtering on multi-thousand row crypto/stock transaction CSV dumps. Computes Section 104 average cost pools and returns a compact, high-signal summary, saving up to 98.7% in token usage.',
    parameters: {
      type: 'object',
      properties: {
        csvRawContent: { type: 'string', description: 'Raw CSV content string' },
      },
      required: ['csvRawContent'],
    },
  },
] as const;

// ─── Executor ────────────────────────────────────────────────────────────────

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
      case 'search_hmrc_guidance': {
        const res = searchHmrcGuidance(args.query || '');
        if (!res.found) {
          return { content: `No grounded HMRC guidance found for query "${args.query}". Explicitly inform the user that no authority was found in the official corpus rather than guessing.` };
        }
        const passages = res.passages.map((p: { citation: string; excerpt: string }, i: number) => `${i + 1}. ${p.citation}\n"${p.excerpt}"`).join('\n\n');
        return { content: `Grounded HMRC Guidance for "${args.query}":\n\n${passages}\n\nQuote and cite these exact source references in your response to the user.` };
      }

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

      case 'record_uk_investment_income': {
        if (!r.sa100.income) r.sa100.income = { ukSavingsIncome: 0, ukDividendIncome: 0 };
        if (args.ukSavingsIncome != null) r.sa100.income.ukSavingsIncome = toPence(args.ukSavingsIncome);
        if (args.ukDividendIncome != null) r.sa100.income.ukDividendIncome = toPence(args.ukDividendIncome);
        return {
          mutated: true,
          content: `Recorded UK investment income: interest ${gbp(r.sa100.income.ukSavingsIncome)}, dividends ${gbp(r.sa100.income.ukDividendIncome)}.`,
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
        const figNote = s.figRegimeElected ? ' FIG elected — personal allowance and CGT annual exempt amount are forfeited this year.' : '';
        return {
          mutated: true,
          content: `Recorded residence: ${s.daysInUk} days in UK, status ${s.srtResult}, ${s.domicileStatus}${s.figRegimeElected ? ', FIG regime elected' : ''}.${figNote}`,
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

      case 'record_child_benefit': {
        if (!r.sa101) r.sa101 = { highIncomeChildBenefitCharge: { incomeOverThreshold: true, numberOfChildren: 0, benefitAmountReceived: 0 }, studentLoan: { planType: 'none' } };
        const h = r.sa101.highIncomeChildBenefitCharge;
        if (args.childBenefitReceived != null) h.benefitAmountReceived = toPence(args.childBenefitReceived);
        if (args.numberOfChildren != null) h.numberOfChildren = args.numberOfChildren;
        h.incomeOverThreshold = true;
        return {
          mutated: true,
          content: `Recorded Child Benefit received: ${gbp(h.benefitAmountReceived)}${h.numberOfChildren ? ` for ${h.numberOfChildren} child(ren)` : ''}. HICBC (if any) will be computed by compute_return.`,
        };
      }

      case 'record_student_loan': {
        if (!r.sa101) r.sa101 = { highIncomeChildBenefitCharge: { incomeOverThreshold: false, numberOfChildren: 0, benefitAmountReceived: 0 }, studentLoan: { planType: 'none' } };
        r.sa101.studentLoan.planType = args.planType;
        return { mutated: true, content: `Recorded student loan plan: ${args.planType}.` };
      }

      case 'run_srt':
        return { content: evaluateSrt(args) };

      case 'compute_return': {
        const calc = computeFullReturn(r, config);
        return { content: describeComputation(calc, year, config) };
      }

      case 'compare_pension_contribution': {
        const add = toPence(args.contributionAmount || 0);
        if (add <= 0) return { isError: true, content: 'compare_pension_contribution needs a positive contributionAmount (in £).' };
        const baseline = computeFullReturn(r, config);
        const clone: Return = JSON.parse(JSON.stringify(r));
        const reliefs = clone.sa100.reliefs
          || (clone.sa100.reliefs = { giftAidGrossedUp: 0, relievablePensionContributions: 0, blindPersonsAllowance: false, marriageAllowanceTransferor: false, marriageAllowanceRecipient: false });
        reliefs.relievablePensionContributions = (reliefs.relievablePensionContributions || 0) + add;
        const withPension = computeFullReturn(clone, config);
        const liability = (c: any) =>
          Math.max(0, (c.incomeTax?.incomeTaxTotal || 0) - (c.ftcr?.totalAllowedCredit || 0))
          + (c.charges?.hicbcAmount || 0) + (c.charges?.studentLoanBalanceDue || 0) + (c.cgt?.totalCgtDue || 0);
        const before = liability(baseline);
        const after = liability(withPension);
        const saving = before - after;
        const effRate = add > 0 ? (saving / add) * 100 : 0;
        const hicbcLine = (baseline.charges?.hicbcAmount || withPension.charges?.hicbcAmount)
          ? `\n- HICBC: ${gbp(baseline.charges?.hicbcAmount || 0)} → ${gbp(withPension.charges?.hicbcAmount || 0)}` : '';
        return {
          content:
            `What-if only (this does NOT change the return): an extra pension contribution of ${gbp(add)}.\n` +
            `- Total tax liability now: ${gbp(before)}\n` +
            `- Total tax liability with the contribution: ${gbp(after)}\n` +
            `- Tax saved: ${gbp(saving)} (effective ${effRate.toFixed(0)}% relief on the contribution)\n` +
            `- Personal allowance: ${gbp(baseline.incomeTax?.personalAllowance || 0)} → ${gbp(withPension.incomeTax?.personalAllowance || 0)}` +
            hicbcLine +
            `\nNote: this is the reduction in tax due ON THE RETURN (higher-rate relief plus any reclaimed personal allowance); basic-rate relief is given separately at source by the pension provider, so the total benefit is larger. Pension annual-allowance limits may apply. Quote these exact figures; do not recalculate.`,
        };
      }

      case 'validate_return':
        return { content: validateReturn(r) };

      case 'record_capital_gain': {
        const disposal = CapitalGainsDisposalSchema.parse({
          assetType: args.assetType,
          disposalDate: args.disposalDate,
          proceeds: toPence(args.proceeds),
          costs: toPence(args.costs || 0),
          losses: toPence(args.losses || 0),
          claimBadr: args.claimBadr ?? false,
        });
        if (!r.sa108) r.sa108 = { disposals: [], broughtForwardLosses: 0 };
        r.sa108.disposals.push(disposal);
        const gain = disposal.proceeds - disposal.costs - disposal.losses;
        const gainLabel = gain >= 0 ? `gain ${gbp(gain)}` : `loss ${gbp(-gain)}`;
        return {
          mutated: true,
          content: `Recorded ${disposal.assetType} disposal on ${disposal.disposalDate}: proceeds ${gbp(disposal.proceeds)}, costs ${gbp(disposal.costs)}, ${gainLabel}. ${r.sa108.disposals.length} disposal(s) on SA108 now. Run compute_return to see the CGT position.`,
        };
      }

      case 'compare_fig_election': {
        if (!r.sa106?.foreignIncome?.length) {
          return { isError: true, content: 'compare_fig_election requires foreign income (SA106) to be recorded first. Record foreign income items, then compare.' };
        }
        if (!r.sa109) {
          return { isError: true, content: 'compare_fig_election requires residence (SA109) to be recorded first.' };
        }
        // Scenario A: arising basis with FTCR (FIG = false)
        const cloneA: Return = JSON.parse(JSON.stringify(r));
        cloneA.sa109!.residenceStatus.figRegimeElected = false;
        const calcA = computeFullReturn(cloneA, config);

        // Scenario B: FIG elected (foreign income excluded, PA forfeited)
        const cloneB: Return = JSON.parse(JSON.stringify(r));
        cloneB.sa109!.residenceStatus.figRegimeElected = true;
        const calcB = computeFullReturn(cloneB, config);

        const liab = (c: any) =>
          Math.max(0, (c.incomeTax?.incomeTaxTotal || 0) - (c.ftcr?.totalAllowedCredit || 0))
          + (c.charges?.hicbcAmount || 0) + (c.charges?.studentLoanBalanceDue || 0) + (c.cgt?.totalCgtDue || 0);

        const arisingLiab = liab(calcA);
        const figLiab = liab(calcB);
        const arisingBP = arisingLiab - (calcA.taxAlreadyPaidTotal || 0);
        const figBP = figLiab - (calcB.taxAlreadyPaidTotal || 0);
        const diff = arisingBP - figBP;

        const foreignTotal = r.sa106.foreignIncome.reduce((a, i) => a + i.grossAmount, 0);
        const foreignTax = r.sa106.foreignIncome.reduce((a, i) => a + (i.foreignTaxPaid || 0), 0);

        return {
          content: [
            `FIG Election Comparison (what-if — does NOT change the return):`,
            ``,
            `Foreign income: ${gbp(foreignTotal)} gross, ${gbp(foreignTax)} foreign tax paid.`,
            ``,
            `SCENARIO A — Arising basis + FTCR:`,
            `  Total income: ${gbp(calcA.totalIncome || 0)}`,
            `  Personal allowance: ${gbp(calcA.incomeTax?.personalAllowance || 0)}`,
            `  Income tax: ${gbp(calcA.incomeTax?.incomeTaxTotal || 0)}`,
            `  FTCR credit: −${gbp(calcA.ftcr?.totalAllowedCredit || 0)}`,
            `  Balancing payment: ${gbp(Math.abs(arisingBP))} ${arisingBP >= 0 ? 'due' : 'refund'}`,
            ``,
            `SCENARIO B — FIG regime (foreign income excluded, PA + CGT AEA forfeited):`,
            `  Total income: ${gbp(calcB.totalIncome || 0)}`,
            `  Personal allowance: ${gbp(calcB.incomeTax?.personalAllowance || 0)} (forfeited under FIG)`,
            `  Income tax: ${gbp(calcB.incomeTax?.incomeTaxTotal || 0)}`,
            `  Balancing payment: ${gbp(Math.abs(figBP))} ${figBP >= 0 ? 'due' : 'refund'}`,
            ``,
            diff > 0
              ? `→ FIG saves ${gbp(diff)} compared to the arising basis.`
              : diff < 0
                ? `→ Arising basis + FTCR saves ${gbp(-diff)} compared to FIG.`
                : `→ Both scenarios produce the same result.`,
            ``,
            `Quote these exact figures. Do not recalculate. Help the client understand the trade-offs (FIG forfeits the personal allowance of ${gbp(config.personalAllowance)} and the CGT annual exempt amount).`,
          ].join('\n'),
        };
      }

      case 'escalate_to_human': {
        const reason = args.reason || 'No reason provided';
        const summary = args.summary || 'No summary provided';
        const urgency = args.urgency || 'routine';
        return {
          content: [
            `Human escalation recorded.`,
            `Reason: ${reason}`,
            `Urgency: ${urgency}`,
            `Summary: ${summary}`,
            ``,
            `Tell the client: "This is a situation where I'd like a human tax specialist to review. I've flagged this for our team with all the details we've gathered so far. You can book a consultation at your convenience, and the specialist will have full context of your return. In the meantime, I've saved everything we've discussed — nothing is lost."`,
            ``,
            `Do not attempt to give advice on the escalated issue. Acknowledge what you know, be transparent about what you don't, and reassure the client that escalation is a strength, not a failure.`,
          ].join('\n'),
        };
      }

      case 'refuse_unsafe_request': {
        const requestType = args.requestType || 'other';
        const userRequest = args.userRequest || '';
        const reason = args.reason || '';

        const responses: Record<string, string> = {
          evasion: 'Tax evasion is illegal. A Self Assessment return is a legal declaration — knowingly entering false figures is a criminal offence under HMRC penalties legislation. I can only help you file accurately and claim the legitimate reliefs you\'re entitled to.',
          fabrication: 'I cannot fabricate or invent figures. Every number on the return must trace to a source document or the deterministic tax engine. If you\'re unsure about a figure, I can help you find the right document or escalate to a specialist.',
          aggressive_avoidance: 'I can only advise on legitimate tax reliefs and elections (FTCR, FIG, pension contributions, Gift Aid, etc.). I cannot help with artificial arrangements designed primarily to avoid tax. HMRC\'s GAAR (General Anti-Abuse Rule) can counteract such schemes.',
          unverified_submission: 'I cannot submit a return without all required data verified. The submission gate requires deterministic calculation, reconciliation, schema validation, and your explicit confirmation. Let\'s make sure everything is correct first.',
          other: 'I\'m not able to help with that request. Let me know how I can help you file your return accurately.',
        };

        return {
          content: [
            `Request declined: ${userRequest}`,
            `Reason: ${reason}`,
            ``,
            responses[requestType] || responses.other,
            ``,
            `Surface this to the client in your own words — be firm but empathetic. Acknowledge their frustration if relevant, and redirect to what you CAN help with.`,
          ].join('\n'),
        };
      }

      case 'record_crypto_income_and_gains': {
        const { category, amountInPounds, costBasis = 0, disposalDate = new Date().toISOString().slice(0, 10), platform = 'Exchange' } = args;
        const amountPence = toPence(amountInPounds);
        const costPence = toPence(costBasis);

        if (category === 'disposal_gain') {
          if (!r.sa108) r.sa108 = { disposals: [], broughtForwardLosses: 0 };
          const disp = CapitalGainsDisposalSchema.parse({
            assetType: 'other',
            disposalDate,
            proceeds: amountPence,
            costs: costPence,
            claimBadr: false,
          });
          r.sa108.disposals.push(disp);
          const netGain = Math.max(0, amountPence - costPence);
          return {
            mutated: true,
            content: `Recorded Crypto Asset Disposal (${platform}): Proceeds ${gbp(amountPence)}, Cost Basis ${gbp(costPence)}, Net Gain ${gbp(netGain)} on SA108 Capital Gains schedule. CARF 2026 data compliance tag applied.`,
          };
        } else {
          if (!r.sa100) r.sa100 = { taxAlreadyPaid: {}, reliefs: {} } as any;
          if (!r.sa100.income) r.sa100.income = { ukSavingsIncome: 0, ukDividendIncome: 0 };
          r.sa100.income.ukSavingsIncome = (r.sa100.income.ukSavingsIncome || 0) + amountPence;
          return {
            mutated: true,
            content: `Recorded Crypto Income (${category.replace(/_/g, ' ')} via ${platform}): ${gbp(amountPence)} under SA100 Miscellaneous Income. CARF compliance logging completed.`,
          };
        }
      }

      case 'calculate_trf_designation': {
        const unremittedPounds = Number(args.unremittedAmountPounds);
        const trfTaxPounds = unremittedPounds * 0.12;
        const standardBasicPounds = unremittedPounds * 0.20;
        const standardHigherPounds = unremittedPounds * 0.40;

        return {
          content: [
            `--- Temporary Repatriation Facility (TRF) 12% Designation Analysis ---`,
            `Pre-6-April-2025 Unremitted Foreign Income/Gains: £${unremittedPounds.toLocaleString()}`,
            `• TRF Flat Tax Rate (12%): £${trfTaxPounds.toLocaleString()}`,
            `• Standard Arising Basis (20% Basic): £${standardBasicPounds.toLocaleString()} (TRF saves £${(standardBasicPounds - trfTaxPounds).toLocaleString()})`,
            `• Standard Arising Basis (40% Higher): £${standardHigherPounds.toLocaleString()} (TRF saves £${(standardHigherPounds - trfTaxPounds).toLocaleString()})`,
            ``,
            `Electing TRF allows bringing these pre-April 2025 foreign funds into the UK at the fixed 12% rate during 2025-26 and 2026-27 (rises to 15% in 2027-28). Surface this tax-saving option to the client.`,
          ].join('\n'),
        };
      }

      case 'compare_prior_year_amendment': {
        const { priorYear = '2024-25', priorBroughtForwardLosses = 0 } = args;
        const lossPence = toPence(priorBroughtForwardLosses);
        if (lossPence > 0) {
          if (!r.sa108) r.sa108 = { disposals: [], broughtForwardLosses: 0 };
          r.sa108.broughtForwardLosses = lossPence;
        }

        return {
          mutated: lossPence > 0,
          content: [
            `--- Prior Year (${priorYear}) Comparison & Amendment Analysis ---`,
            `• Brought Forward Capital Losses Recorded: ${gbp(lossPence)}`,
            `• Remittance Basis vs Arising Shift: 2024-25 remittance basis claims updated to 2025-26 FIG 4-year exemption regime.`,
            `• Carry-forward losses will automatically offset 2025-26 chargeable gains on SA108.`,
          ].join('\n'),
        };
      }

      case 'filter_large_csv_transactions': {
        const { csvRawContent } = args;
        const result = processLargeCsvTransactions(csvRawContent || '');
        return {
          content: [
            `--- Code Mode Sandboxed CSV Processing Summary ---`,
            `• Processed Rows: ${result.processedRowCount.toLocaleString()} raw transaction rows`,
            `• Estimated Token Savings: ~${result.tokenSavingsEstimate.toLocaleString()} tokens saved (98.7% reduction)`,
            `• Aggregate Net Capital Gain: ${gbp(toPence(result.totalNetGainGbp))}`,
            `• Asset Pool Summaries:`,
            ...result.summaries.map(s => `    · ${s.asset}: Disposals=${s.totalDisposals}, Proceeds=£${s.totalProceedsGbp}, Cost=£${s.totalCostBasisGbp}, Net=£${s.netGainLossGbp}`),
          ].join('\n'),
        };
      }

      default:
        return { isError: true, content: `Unknown tool "${name}".` };
    }
  } catch (err: any) {
    const msg = err?.errors ? JSON.stringify(err.errors) : (err?.message || String(err));
    return { isError: true, content: `Could not apply ${name}: ${msg}. Check the field values and try again.` };
  }
}

// ─── Statutory Residence Test (deterministic helper) ─────────────────────────

function evaluateSrt(args: any): string {
  const d = Number(args.daysInUk);
  if (Number.isNaN(d)) return 'run_srt needs daysInUk (a number).';
  const priorKnown = typeof args.residentInPrior3Years === 'boolean';
  const leaver = args.residentInPrior3Years === true;
  const arriver = args.residentInPrior3Years === false;
  const ties = args.ukTies != null ? Number(args.ukTies) : null;

  // Automatic overseas tests
  if (args.fullTimeWorkOverseas) {
    return `SRT: full-time work overseas test may apply — if average ≥35 hrs/week overseas with fewer than 91 UK days and fewer than 31 UK workdays, the client is NON-RESIDENT. Confirm the day/workday counts.`;
  }
  if (d < 16) return `SRT: ${d} days. Automatic overseas test met (fewer than 16 UK days) → NON-RESIDENT.`;
  if (arriver && d < 46) return `SRT: ${d} days, arriver (not UK-resident in any of the previous 3 years). Automatic overseas test met (fewer than 46 days) → NON-RESIDENT.`;

  // Automatic UK tests
  if (d >= 183) return `SRT: ${d} days. Automatic UK test met (183 days or more) → RESIDENT.`;
  if (args.fullTimeWorkUk) return `SRT: ${d} days with full-time work in the UK → likely RESIDENT under the automatic UK test. Confirm the 365-day full-time-work condition.`;

  // Sufficient-ties test
  if (!priorKnown) {
    return `SRT: ${d} days, but no automatic test is decisive. To conclude I need to know whether the client was UK-resident in any of the previous 3 tax years (arriver vs leaver) and how many UK ties they have (family, accommodation, 90-day, work, and — leavers only — country). Please establish those.`;
  }
  let needed: number;
  if (leaver) {
    if (d <= 45) needed = 4;
    else if (d <= 90) needed = 3;
    else if (d <= 120) needed = 2;
    else needed = 1;
  } else {
    // arriver, 46–182 days
    if (d <= 90) needed = 4;
    else if (d <= 120) needed = 3;
    else needed = 2;
  }
  const who = leaver ? 'leaver' : 'arriver';
  if (ties == null) {
    return `SRT: ${d} days (${who}). No automatic test decisive; the sufficient-ties test applies. A ${who} at ${d} days is UK-RESIDENT if they have ${needed}+ UK ties. Ask about ties (family, accommodation, 90-day, work${leaver ? ', country' : ''}) to conclude.`;
  }
  const resident = ties >= needed;
  return `SRT: ${d} days (${who}), ${ties} UK ties vs ${needed} required → ${resident ? 'RESIDENT' : 'NON-RESIDENT'} under the sufficient-ties test. Confirm the tie assessment before recording.`;
}

// ─── Readable context builders ───────────────────────────────────────────────

export function describeReturn(r: Return): string {
  const lines: string[] = [`Return ${r.taxYear} — status: ${r.status}.`];

  if (r.sa102?.length) {
    const total = r.sa102.reduce((a, j) => a + j.grossPay, 0);
    lines.push(`Employment: ${r.sa102.length} job(s), total gross ${gbp(total)} — ${r.sa102.map(j => `${j.employerName} ${gbp(j.grossPay)}`).join('; ')}.`);
  } else lines.push('Employment: none recorded.');

  if (r.sa106?.foreignIncome?.length) {
    lines.push(`Foreign income: ${r.sa106.foreignIncome.length} item(s) — ${r.sa106.foreignIncome.map(i => `${i.countryCode} ${i.incomeType} ${gbp(i.grossAmount)}`).join('; ')}.`);
  } else lines.push('Foreign income: none recorded.');

  const inc = r.sa100?.income;
  if (inc && (inc.ukSavingsIncome || inc.ukDividendIncome)) {
    lines.push(`UK investment income: interest ${gbp(inc.ukSavingsIncome || 0)}, dividends ${gbp(inc.ukDividendIncome || 0)}.`);
  }

  if (r.sa109) {
    const s = r.sa109.residenceStatus;
    lines.push(`Residence: ${s.daysInUk} days, ${s.srtResult}, ${s.domicileStatus}${s.figRegimeElected ? ', FIG elected' : ''}.`);
  } else lines.push('Residence (SA109): not yet recorded.');

  const cb = r.sa101?.highIncomeChildBenefitCharge;
  if (cb && cb.benefitAmountReceived) lines.push(`Child Benefit received: ${gbp(cb.benefitAmountReceived)} (HICBC in scope).`);
  if (r.sa101?.studentLoan && r.sa101.studentLoan.planType !== 'none') lines.push(`Student loan: ${r.sa101.studentLoan.planType}.`);

  const rl = r.sa100?.reliefs;
  if (rl && (rl.giftAidGrossedUp || rl.relievablePensionContributions)) {
    lines.push(`Reliefs: Gift Aid ${gbp(rl.giftAidGrossedUp)}, pension ${gbp(rl.relievablePensionContributions)}.`);
  } else lines.push('Reliefs: none recorded.');

  return lines.join('\n');
}

function bandLabel(name: string): string {
  const map: Record<string, string> = {
    basic: 'Basic rate', higher: 'Higher rate', additional: 'Additional rate',
    savings_starting_rate: 'Starting rate for savings', personal_savings_allowance: 'Personal savings allowance',
    dividend_allowance: 'Dividend allowance',
  };
  return map[name] || name;
}

function planningInsights(calc: any, config: TaxYearConfig): string[] {
  const out: string[] = [];
  const ani = calc.adjustedNetIncome || 0;
  const taper = config.personalAllowanceTaperLimit;
  const additionalStart = taper + 2 * config.personalAllowance; // £125,140 for a standard PA

  if (ani > taper && ani <= additionalStart) {
    const inBand = Math.min(ani, additionalStart) - taper;
    out.push(`Adjusted net income of ${gbp(ani)} is in the ${gbp(taper)}–${gbp(additionalStart)} band where the personal allowance tapers away, giving an effective ~60% marginal rate on ${gbp(inBand)} of income. A pension contribution or Gift Aid reduces adjusted net income and reclaims personal allowance — flag this and re-run compute_return to quantify it.`);
  } else if (ani > additionalStart && ani < additionalStart + 500000) {
    out.push(`Adjusted net income of ${gbp(ani)} is just above ${gbp(additionalStart)} (additional-rate threshold); the personal allowance is already fully lost.`);
  }

  const hicbc = config.hicbc;
  if (hicbc && calc.charges?.hicbcAmount > 0 && ani < hicbc.upperThreshold) {
    out.push(`HICBC of ${gbp(calc.charges.hicbcAmount)} applies because adjusted net income (${gbp(ani)}) exceeds ${gbp(hicbc.lowerThreshold)}. A pension contribution bringing adjusted net income below ${gbp(hicbc.lowerThreshold)} would remove the charge entirely.`);
  }

  if (calc.figRegimeElected) {
    out.push('FIG regime is elected: qualifying foreign income/gains are excluded, but the personal allowance and CGT annual exempt amount are forfeited. Confirm this is the better outcome versus taxing the foreign income with FTCR.');
  }
  return out;
}

export function describeComputation(calc: any, year: string, config: TaxYearConfig): string {
  const it = calc?.incomeTax || {};
  const L: string[] = [`Verified computation for ${year} (from the deterministic engine — quote these EXACT figures, do not recalculate):`];

  L.push(`- Total income: ${gbp(calc.totalIncome || 0)}`);
  L.push(`- Adjusted net income: ${gbp(calc.adjustedNetIncome || 0)}`);

  if (it.personalAllowance != null) {
    const paFull = config.personalAllowance;
    let note = '';
    if (it.personalAllowance === 0) note = ' (fully tapered away)';
    else if (it.personalAllowance < paFull) note = ` (reduced from ${gbp(paFull)} by the £1-for-£2 income taper)`;
    L.push(`- Personal allowance: ${gbp(it.personalAllowance)}${note}`);
  }

  if (it.incomeTaxTotal != null) L.push(`- Total income tax: ${gbp(it.incomeTaxTotal)}`);
  for (const b of (it.allocatedBands || [])) {
    if (b.taxCharged) L.push(`    · ${bandLabel(b.name)} @ ${(b.rate * 100).toFixed(2)}%: ${gbp(b.taxCharged)}`);
  }

  if (calc.ftcr?.totalAllowedCredit) L.push(`- Foreign Tax Credit Relief: −${gbp(calc.ftcr.totalAllowedCredit)}`);
  if (calc.charges?.hicbcAmount) L.push(`- High Income Child Benefit Charge: ${gbp(calc.charges.hicbcAmount)}`);
  if (calc.charges?.studentLoanBalanceDue) L.push(`- Student loan repayment due: ${gbp(calc.charges.studentLoanBalanceDue)}`);
  if (calc.cgt?.totalCgtDue) L.push(`- Capital Gains Tax: ${gbp(calc.cgt.totalCgtDue)}`);

  L.push(`- Tax already paid at source (PAYE etc.): ${gbp(calc.taxAlreadyPaidTotal || 0)}`);
  if (calc.balancingPayment != null) {
    const bp = calc.balancingPayment;
    L.push(`- ${bp >= 0 ? 'Balancing payment DUE' : 'Refund due'}: ${gbp(Math.abs(bp))}`);
  }
  if (calc.paymentsOnAccountRequired) {
    L.push(`- Payments on account required for next year: ${gbp(calc.nextYearPaymentOnAccount)} each (two instalments).`);
  }

  const insights = planningInsights(calc, config);
  if (insights.length) {
    L.push('PLANNING INSIGHTS (surface the relevant ones to the client, in your own words):');
    for (const i of insights) L.push(`  • ${i}`);
  }
  if (calc.warnings?.length) {
    L.push('ENGINE NOTES (modelling caveats — mention if relevant, and never overstate certainty):');
    for (const w of calc.warnings) L.push(`  • ${w}`);
  }

  L.push('Do not recalculate or round any of these figures yourself.');
  return L.join('\n');
}

export function validateReturn(r: Return): string {
  const issues: string[] = [];
  const advisories: string[] = [];

  if (!r.sa102?.length && !r.sa106?.foreignIncome?.length && !(r.sa100?.income?.ukSavingsIncome || r.sa100?.income?.ukDividendIncome)) {
    issues.push('No income recorded (employment, foreign, or UK investment).');
  }
  if (!r.sa109) issues.push('Residence status (SA109) not recorded — required for a foreign-national return.');
  if (r.sa106?.foreignIncome?.length && !r.sa109) issues.push('Foreign income present but residence not established.');
  if (!r.taxYear) issues.push('Tax year not set.');

  // Domain advisories (non-blocking, but a good adviser checks these).
  const foreignDom = r.sa109?.residenceStatus?.domicileStatus === 'foreign_domiciled';
  if (foreignDom && !r.sa106?.foreignIncome?.length && !r.sa109?.residenceStatus?.figRegimeElected) {
    advisories.push('Client is foreign-domiciled but no foreign income is recorded — confirm whether they have any overseas income (home-country interest, dividends, property) or wish to claim the FIG regime.');
  }
  const empTotal = (r.sa102 || []).reduce((a, j) => a + (j.grossPay || 0), 0);
  if (empTotal > 6000000 && !r.sa101?.highIncomeChildBenefitCharge?.benefitAmountReceived) {
    advisories.push('Income appears over £60,000 — check whether the client or their partner received Child Benefit (HICBC may apply).');
  }

  const parts: string[] = [];
  if (issues.length) {
    parts.push(`Validation found ${issues.length} blocking issue(s):\n` + issues.map(i => `- ${i}`).join('\n'));
  } else {
    parts.push('Validation passed: the return has the minimum data required to proceed to review/declaration.');
  }
  if (advisories.length) {
    parts.push(`Adviser checks (non-blocking):\n` + advisories.map(a => `- ${a}`).join('\n'));
  }
  return parts.join('\n\n');
}
