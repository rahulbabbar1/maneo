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
    content: 'Split-year treatment applies when an individual moves into or out of the UK during a tax year under specific Cases (1–8). Income arising during the overseas part of the year is generally excluded from UK tax.',
    keywords: ['split-year', 'split year', 'arriver', 'leaver', 'sa109', 'case 4', 'case 5', 'case 8'],
  },
  {
    id: 'fig-regime-4yr',
    topic: 'Foreign Income & Gains (FIG) Regime',
    sourceFile: 'hmrc_docs/FIG_Regime_Technical_Note_2025-26.pdf',
    section: 'Section 1.2 — 4-Year 100% Foreign Income Relief',
    content: 'From 6 April 2025 (2025-26 tax year), qualifying new arrivers who were non-UK resident for 10 consecutive tax years prior to arrival can elect the FIG regime to receive 100% tax relief on qualifying foreign income and gains for up to 4 tax years. Electing FIG forfeits the UK Personal Allowance (£12,570) and Capital Gains Tax AEA.',
    keywords: ['fig', 'fig regime', 'foreign income and gains', '4-year', 'relief', 'remittance', 'personal allowance'],
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
    content: 'The Personal Allowance (£12,570) is reduced by £1 for every £2 of adjusted net income above £100,000. The Personal Allowance reaches zero when adjusted net income reaches £125,140.',
    keywords: ['personal allowance', 'taper', '100000', '100k', 'adjusted net income', '125140'],
  },
  {
    id: 'hicbc-thresholds',
    topic: 'High Income Child Benefit Charge (HICBC)',
    sourceFile: 'hmrc_docs/Calculate-Tax-and-NIC-MTR-2024-25-v2.4.1a.odt',
    section: 'Section 7.3 — HICBC Thresholds',
    content: 'For tax year 2024-25 onwards, HICBC starts when adjusted net income exceeds £60,000. The charge equals 1% of the total Child Benefit received for every £200 of income between £60,000 and £80,000 (100% charge at £80,000).',
    keywords: ['hicbc', 'child benefit', '60000', '60k', '80000', '80k', 'charge'],
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
