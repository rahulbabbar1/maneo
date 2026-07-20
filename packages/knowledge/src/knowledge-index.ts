export interface HmrcPassage {
  id: string;
  topic: string;
  sourceFile: string;
  section: string;
  content: string;
  keywords: string[];
}

export interface SearchGuidanceResult {
  found: boolean;
  query: string;
  passages: {
    citation: string;
    excerpt: string;
    score: number;
  }[];
}

const HMRC_KNOWLEDGE_BASE: HmrcPassage[] = [
  // ── Original 6 passages (verified) ──────────────────────────────────────────
  {
    id: 'srt-days-183',
    topic: 'Statutory Residence Test (SRT)',
    sourceFile: 'hmrc_docs/RDR3_Statutory_Residence_Test_Guidance.pdf',
    section: 'Section 2.1 — Automatic UK Tests',
    content: 'Under the Statutory Residence Test (SRT), an individual is automatically UK resident if they spend 183 days or more in the UK in a tax year. No further ties tests are required.',
    keywords: ['srt', 'residence', 'days', '183', 'automatic uk test', 'resident'],
  },
  {
    id: 'srt-split-year',
    topic: 'Split-Year Treatment (SA109)',
    sourceFile: 'hmrc_docs/SA109_Residence_and_FIG_Notes.pdf',
    section: 'Page TRN 2 — Split-Year Cases',
    content: 'Split-year treatment applies when an individual moves into or out of the UK during a tax year under specific Cases (1–8). Income arising during the overseas part of the year is generally excluded from UK tax. Split-year treatment is NOT automatically applied by HMRC — the individual must actively claim it on their Self Assessment return using supplementary form SA109.',
    keywords: ['split-year', 'split year', 'arriver', 'leaver', 'sa109', 'case 4', 'case 5', 'case 8', 'claim'],
  },
  {
    id: 'fig-regime-4yr',
    topic: 'Foreign Income & Gains (FIG) Regime',
    sourceFile: 'hmrc_docs/FIG_Regime_Technical_Note_2025-26.pdf',
    section: 'Section 1.2 — 4-Year 100% Foreign Income Relief',
    content: 'From 6 April 2025 (2025-26 tax year), qualifying new arrivers who were non-UK resident for 10 consecutive tax years prior to arrival can elect the FIG regime to receive 100% tax relief on qualifying foreign income and gains for up to 4 tax years. Electing FIG forfeits the UK Personal Allowance (£12,570) and Capital Gains Tax AEA (£3,000). The election must be made annually on SA109.',
    keywords: ['fig', 'fig regime', 'foreign income and gains', '4-year', 'relief', 'remittance', 'personal allowance', 'non-dom', 'qualifying', '10 years'],
  },
  {
    id: 'ftcr-india-dta',
    topic: 'Foreign Tax Credit Relief (FTCR) & UK–India DTA',
    sourceFile: 'hmrc_docs/Double_Taxation_Relief_Manual_INTM160000.pdf',
    section: 'INTM162000 — UK/India Double Taxation Convention Article 11',
    content: 'Under Article 11 of the UK–India Double Taxation Convention, foreign tax credit relief on Indian dividends is capped at the treaty rate limit of 15% of the gross dividend. Any foreign tax paid exceeding 15% cannot be claimed as FTCR against UK tax.',
    keywords: ['ftcr', 'foreign tax credit relief', 'india', 'dta', 'double taxation', 'treaty', '15%', 'dividends'],
  },
  {
    id: 'pa-taper-100k',
    topic: 'Personal Allowance Tapering',
    sourceFile: 'hmrc_docs/Calculate-Tax-and-NIC-MTR-2024-25-v2.4.1a.odt',
    section: 'Section 4.1 — Personal Allowance Tapering at £100,000',
    content: 'The Personal Allowance (£12,570) is reduced by £1 for every £2 of adjusted net income above £100,000. The Personal Allowance reaches zero when adjusted net income reaches £125,140. This creates an effective marginal rate of approximately 60% in the £100,000–£125,140 band.',
    keywords: ['personal allowance', 'taper', '100000', '100k', 'adjusted net income', '125140', '60%', 'marginal rate'],
  },
  {
    id: 'hicbc-thresholds',
    topic: 'High Income Child Benefit Charge (HICBC)',
    sourceFile: 'hmrc_docs/Calculate-Tax-and-NIC-MTR-2024-25-v2.4.1a.odt',
    section: 'Section 7.3 — HICBC Thresholds',
    content: 'For tax year 2024-25 onwards, HICBC starts when adjusted net income exceeds £60,000. The charge equals 1% of the total Child Benefit received for every £200 of income between £60,000 and £80,000 (100% charge at £80,000). A pension contribution or Gift Aid donation reducing adjusted net income below £60,000 removes the charge entirely.',
    keywords: ['hicbc', 'child benefit', '60000', '60k', '80000', '80k', 'charge', 'pension'],
  },

  // ── New passages (D4 knowledge expansion) ───────────────────────────────────

  {
    id: 'owr-relief',
    topic: 'Overseas Workday Relief (OWR)',
    sourceFile: 'hmrc_docs/FIG_Regime_Technical_Note_2025-26.pdf',
    section: 'Section 3.1 — Overseas Workday Relief',
    content: 'From 6 April 2025, Overseas Workday Relief (OWR) applies for up to 4 tax years, tied to FIG eligibility. OWR provides relief on the overseas portion of qualifying employment income, subject to an annual financial limit: the lower of 30% of the qualifying employment income for the year or £300,000. The individual must be a qualifying new resident (non-UK-resident for at least 10 consecutive tax years prior to arrival).',
    keywords: ['owr', 'overseas workday relief', 'workday', '30%', '300000', 'employment', 'fig', 'qualifying'],
  },
  {
    id: 'trf-repatriation',
    topic: 'Temporary Repatriation Facility (TRF)',
    sourceFile: 'hmrc_docs/FIG_Regime_Technical_Note_2025-26.pdf',
    section: 'Section 4 — Temporary Repatriation Facility',
    content: 'The Temporary Repatriation Facility (TRF) allows individuals who claimed the remittance basis before 6 April 2025 to designate pre-April-2025 unremitted foreign income and gains at a reduced rate: 12% for 2025-26 and 2026-27, rising to 15% for 2027-28. This is a time-limited facility intended to encourage bringing historic foreign income to the UK.',
    keywords: ['trf', 'temporary repatriation', 'remittance', '12%', '15%', 'unremitted', 'designate', 'non-dom'],
  },
  {
    id: 'crypto-cgt',
    topic: 'Cryptocurrency Capital Gains Tax',
    sourceFile: 'hmrc_docs/HMRC_Crypto_Assets_Manual_CRYPTO.pdf',
    section: 'CRYPTO40000 — Capital Gains Tax on crypto assets',
    content: 'Disposals of cryptocurrency (including crypto-to-crypto swaps, crypto-to-fiat, and using crypto to buy goods/services) are chargeable events for CGT. The annual exempt amount is £3,000 (2024-25 onwards). Reporting is required if gains exceed the AEA OR gross disposal proceeds exceed £50,000. Share-pooling rules apply: same-day rule, 30-day "bed and breakfast" rule, then Section 104 pool. Wallet-to-wallet transfers of the same asset are NOT disposals. CARF (Crypto-Asset Reporting Framework) from January 2026 means HMRC will cross-check exchange data.',
    keywords: ['crypto', 'cryptocurrency', 'bitcoin', 'cgt', 'capital gains', 'disposal', 'share pooling', 'section 104', '50000', 'carf', 'koinly'],
  },
  {
    id: 'rsu-taxation',
    topic: 'RSU (Restricted Stock Unit) Taxation',
    sourceFile: 'hmrc_docs/Employment_Income_Manual_EIM.pdf',
    section: 'EIM11953 — Restricted Stock Units',
    content: 'When RSUs vest, the market value at vesting is treated as employment income (already included in the P60/PAYE). Only post-vest growth (the difference between the sale price and the market value at vesting) is a capital gain for CGT purposes. If shares are sold immediately at vesting ("sell-to-cover"), there is typically no CGT event since there is no post-vest growth. US withholding on RSUs may be claimable as FTCR on SA106 under the UK-US DTA. The "RSU OFFSET" on payslips reflects the sold-to-cover deduction and is NOT additional income.',
    keywords: ['rsu', 'restricted stock', 'vesting', 'employment income', 'p60', 'capital gains', 'sell to cover', 'us withholding', 'ftcr'],
  },
  {
    id: 'sa-registration-deadline',
    topic: 'Self Assessment Registration Deadline',
    sourceFile: 'hmrc_docs/SA_Registration_and_Deadlines.pdf',
    section: 'Section 1 — Registration Requirements',
    content: 'Individuals who need to file a Self Assessment tax return for the first time must register by 5 October following the end of the tax year in which they became liable. For example, a foreign national arriving in the UK during 2025-26 must register by 5 October 2026. Registration is done online via the Government Gateway or by form SA1. Late registration can delay the UTR (Unique Taxpayer Reference) and risk penalties.',
    keywords: ['register', 'registration', 'sa1', '5 october', 'deadline', 'utr', 'first time', 'arriver', 'gateway'],
  },
  {
    id: 'foreign-dividends-deminimis',
    topic: 'Foreign Dividends De Minimis Threshold',
    sourceFile: 'hmrc_docs/SA106_Foreign_Income_Notes.pdf',
    section: 'Page F1 — When to use SA106',
    content: 'Foreign dividends and interest under £2,000 (total, not per source) can be reported on the main SA100 return without completing SA106, provided no FTCR is being claimed. Foreign dividends under £300 can be combined with UK dividends if not claiming FTCR. However, if claiming Foreign Tax Credit Relief, SA106 must be completed regardless of the amount.',
    keywords: ['foreign dividends', 'de minimis', '2000', '300', 'sa106', 'threshold', 'ftcr', 'small amount'],
  },
  {
    id: 'irish-etf-trap',
    topic: 'Irish/Luxembourg-Domiciled ETF Dividend Treatment',
    sourceFile: 'hmrc_docs/SA106_Foreign_Income_Notes.pdf',
    section: 'Box F1 — Foreign Dividends',
    content: 'Dividends from Irish or Luxembourg-domiciled ETFs (including UK-tracking ETFs like iShares FTSE 100 UCITS ETF domiciled in Dublin) are foreign dividends for UK tax purposes and must be reported as such. Additionally, holders of reporting funds must include any "excess reportable income" (ERI) — the difference between the fund\'s reportable income and actual distributions. This is often overlooked by investors who assume a UK-tracking ETF produces UK income.',
    keywords: ['irish etf', 'luxembourg', 'dublin', 'foreign dividend', 'excess reportable income', 'eri', 'ishares', 'ucits', 'reporting fund'],
  },
  {
    id: 'dta-uk-usa',
    topic: 'UK-USA Double Taxation Agreement',
    sourceFile: 'hmrc_docs/Double_Taxation_Relief_Manual_INTM160000.pdf',
    section: 'INTM164000 — UK/US Double Taxation Convention',
    content: 'Under the UK-US Double Taxation Convention: dividends are subject to a 15% treaty withholding cap (Article 10). Interest is generally 0% (Article 11, with exceptions). For US citizens/residents with UK employment income, Article 14 applies. FTCR for US federal tax paid on employment income (including RSU income) can be claimed on SA106. W-8BEN certification is required for reduced US withholding rates.',
    keywords: ['usa', 'us', 'united states', 'dta', 'treaty', '15%', 'dividends', 'interest', 'w-8ben', 'rsu', 'ftcr'],
  },
  {
    id: 'marriage-allowance',
    topic: 'Marriage Allowance Eligibility',
    sourceFile: 'hmrc_docs/Calculate-Tax-and-NIC-MTR-2024-25-v2.4.1a.odt',
    section: 'Section 5.2 — Marriage Allowance Transfer',
    content: 'Marriage Allowance allows a spouse or civil partner to transfer up to £1,260 (10% of the personal allowance) to their partner, provided: (1) both are married or in a civil partnership, (2) the transferor\'s income is below the personal allowance (£12,570), and (3) the recipient is a basic-rate taxpayer (income below £50,270). CRITICAL: both spouses must be UK taxpayers. A non-UK-taxpaying spouse (e.g. living in Germany, not earning UK income) does NOT qualify as a transferor. Claiming incorrectly is a false claim on the return.',
    keywords: ['marriage allowance', 'spouse', 'civil partner', 'transfer', '1260', 'basic rate', 'eligibility', 'false claim'],
  },
  {
    id: 'capital-losses',
    topic: 'Capital Losses — Claiming and Carry-Forward',
    sourceFile: 'hmrc_docs/HMRC_CGT_Manual_CG15800.pdf',
    section: 'CG15800 — Capital Losses',
    content: 'Capital losses must be claimed — they are not applied automatically by HMRC. Current-year losses must be set against current-year gains in full, even if this wastes the annual exempt amount. Brought-forward losses are only used to reduce net gains down to the annual exempt amount (never below). Unused losses can be carried forward indefinitely but must be reported within 4 years of the end of the tax year in which they arose. Losses between spouses are not transferable.',
    keywords: ['capital loss', 'losses', 'carry forward', 'claim', 'annual exempt', 'aea', 'cgt', '4 years'],
  },
  {
    id: 'nic-self-employment',
    topic: 'National Insurance — Self Employment (Out of Scope Indicator)',
    sourceFile: 'hmrc_docs/Calculate-Tax-and-NIC-MTR-2024-25-v2.4.1a.odt',
    section: 'Section 8 — Class 2 and Class 4 NIC',
    content: 'Self-employed individuals pay Class 2 NIC (flat weekly rate, now £0 from 2024-25 but voluntary contributions still available) and Class 4 NIC (9% on profits between £12,570 and £50,270, 2% above). Self-employment income is reported on SA103 (short) or SA104 (full). Note: Maneo currently serves salaried foreign nationals — self-employment returns are outside the current scope and should be escalated.',
    keywords: ['nic', 'national insurance', 'self employment', 'class 2', 'class 4', 'sa103', 'sa104', 'out of scope'],
  },
  {
    id: 'nr-cgt-uk-property',
    topic: 'Non-Resident CGT on UK Property',
    sourceFile: 'hmrc_docs/HMRC_CGT_Manual_CG73700.pdf',
    section: 'CG73700 — Non-Resident Capital Gains Tax (NRCGT)',
    content: 'Non-UK-residents disposing of UK property (residential or commercial, from 6 April 2019) must report and pay CGT within 60 days of completion using the "Report and pay CGT on UK property" service. This is a separate regime from general CGT reported on SA108. The 60-day reporting requirement exists even if no tax is due. Rates: 18%/24% for residential, 10%/20% for non-residential (same as UK residents). The annual exempt amount (£3,000) is available.',
    keywords: ['non-resident', 'cgt', 'uk property', 'nrcgt', '60 days', 'residential', 'report', 'disposal'],
  },
  {
    id: 'ftcr-cap-logic',
    topic: 'FTCR Cap — Relief Limited to UK Tax on the Income',
    sourceFile: 'hmrc_docs/HS263_Foreign_Tax_Credit_Relief.pdf',
    section: 'Section 3 — Calculating FTCR',
    content: 'Foreign Tax Credit Relief is always the LOWER of: (a) the foreign tax actually paid on the income, and (b) the UK tax charged on the same income. A basic-rate taxpayer who pays 15% US withholding on dividends taxed at 8.75% UK dividend rate can only claim FTCR up to the 8.75% UK charge — the excess foreign tax is not recoverable. Relief is calculated per source of income, not in aggregate.',
    keywords: ['ftcr', 'cap', 'relief', 'lower of', 'uk tax', 'foreign tax', 'hs263', 'per source', 'basic rate'],
  },
  {
    id: 'srt-ties-detail',
    topic: 'SRT Sufficient Ties Test — Tie Definitions',
    sourceFile: 'hmrc_docs/RDR3_Statutory_Residence_Test_Guidance.pdf',
    section: 'Section 4 — The Sufficient Ties Test',
    content: 'The five UK ties are: (1) Family tie — spouse/civil partner or minor child is UK-resident. (2) Accommodation tie — UK accommodation available for a continuous 91-day period, used for at least one night. (3) Work tie — 40+ substantive UK workdays. (4) 90-day tie — spent 90+ days in the UK in either of the previous 2 tax years. (5) Country tie (leavers only) — spent more days in the UK than any other single country. For arrivers, only 4 ties apply (no country tie). The number of ties required for residence depends on the number of UK days: arrivers need 4 ties at 46–90 days, 3 at 91–120, 2 at 121–182.',
    keywords: ['srt', 'ties', 'family tie', 'accommodation tie', 'work tie', '90-day tie', 'country tie', 'sufficient ties', 'arriver', 'leaver', '40 days'],
  },
];

/**
 * Searches the grounded HMRC knowledge base and returns ranked passages with citations.
 */
export function searchHmrcGuidance(query: string): SearchGuidanceResult {
  const cleanQuery = query.toLowerCase().trim();
  const terms = cleanQuery.split(/\s+/).filter(t => t.length > 2);

  const scored = HMRC_KNOWLEDGE_BASE.map(p => {
    let score = 0;
    for (const term of terms) {
      if (p.keywords.some(k => k.includes(term))) score += 3;
      if (p.topic.toLowerCase().includes(term)) score += 2;
      if (p.content.toLowerCase().includes(term)) score += 1;
    }
    return { passage: p, score };
  })
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      found: false,
      query,
      passages: [],
    };
  }

  return {
    found: true,
    query,
    passages: scored.slice(0, 3).map(s => ({
      citation: `[Source: ${s.passage.sourceFile} | ${s.passage.section}]`,
      excerpt: s.passage.content,
      score: s.score,
    })),
  };
}

export function indexCorpusPassages(): number {
  return HMRC_KNOWLEDGE_BASE.length;
}
