import { createHash } from 'crypto';
import { create } from 'xmlbuilder2';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization } from 'xml-crypto';
import { Return } from '@uk-sa-app/return-model';
import { computeFullReturn } from '@uk-sa-app/tax-core';
import { getConfig, CONFIGS } from '@uk-sa-app/tax-config';

const ENV_NS = 'http://www.govtalk.gov.uk/CM/envelope';
const MTR_NS = 'http://www.govtalk.gov.uk/taxation/SA/SA100/25-26/1';

const money = (pence: number) => (pence / 100).toFixed(2);

function periodEndFor(taxYear: string): string {
  const end = parseInt((taxYear.split('-')[1] || '26'), 10);
  const endYear = end < 100 ? 2000 + end : end;
  return `${endYear}-04-05`;
}

function taxpayerStatus(region?: string): 'U' | 'S' | 'C' {
  if (region === 'scotland') return 'S';
  if (region === 'wales') return 'C';
  return 'U';
}

/**
 * Builds a GovTalk envelope carrying an SA100 MTR return.
 * <GovTalkMessage> is in the CM/envelope namespace; <IRenvelope> is in the
 * SA100 MTR namespace. The IRenvelope payload conforms to MTR-v1-2.xsd
 * (enforced offline by the XSD validation gate in the test suite).
 */
export function buildLegacySaXml(returnObj: Return, region?: string): string {
  const utr = '1234567890'; // TODO: sourced from verified client record
  const periodEnd = periodEndFor(returnObj.taxYear || '2025-26');

  // Verified figures from the deterministic engine (never hand-computed here).
  const config = CONFIGS[returnObj.taxYear]
    ? getConfig(returnObj.taxYear)
    : getConfig(Object.keys(CONFIGS).sort().reverse()[0]);
  const calc: any = computeFullReturn(returnObj, config);
  const totalDuePence =
    (calc?.incomeTax?.incomeTaxTotal || 0) +
    (calc?.charges?.hicbcAmount || 0) -
    (calc?.ftcr?.totalAllowedCredit || 0);

  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const gtm = doc.ele('GovTalkMessage', { xmlns: ENV_NS });
  gtm.ele('EnvelopeVersion').txt('2.0');

  const md = gtm.ele('Header').ele('MessageDetails');
  md.ele('Class').txt('HMRC-SA-SA100-TIL');
  md.ele('Qualifier').txt('request');
  md.ele('Function').txt('submit');
  md.ele('CorrelationID').txt(returnObj.id);
  md.ele('Transformation').txt('XML');
  md.up().ele('SenderDetails');

  gtm.ele('GovTalkDetails').ele('Keys').ele('Key', { Type: 'UTR' }).txt(utr);

  const irEnv = gtm.ele('Body').ele('IRenvelope', { xmlns: MTR_NS });

  // ── IRheader ──
  const irh = irEnv.ele('IRheader');
  irh.ele('Keys').ele('Key', { Type: 'UTR' }).txt(utr);
  irh.ele('PeriodEnd').txt(periodEnd);
  irh.ele('DefaultCurrency').txt('GBP');
  const ref = irh.ele('Manifest').ele('Contains').ele('Reference');
  ref.ele('Namespace').txt(MTR_NS);
  ref.ele('SchemaVersion').txt('2025-v1.2');
  ref.ele('TopElementName').txt('MTR');
  irh.ele('IRmark', { Type: 'generic' }).txt('placeholder_irmark');
  irh.ele('Sender').txt('Agent');

  // ── MTR body ──
  const mtr = irEnv.ele('MTR');
  mtr.ele('SA100').ele('YourPersonalDetails').ele('TaxpayerStatus').txt(taxpayerStatus(region));

  // SA102 — one per employment (schema allows up to 50).
  for (const job of returnObj.sa102 || []) {
    const emp = mtr.ele('SA102').ele('Employment');
    if (job.grossPay) emp.ele('PayFromEmployment').txt(money(job.grossPay));
    if (job.taxDeducted) emp.ele('TaxTakenOffPay').txt(money(job.taxDeducted));
    emp.ele('EmployerPAYEReference').txt((job.employerRef || 'N/A').slice(0, 17));
    if (job.employerName) emp.ele('EmployersName').txt(job.employerName.slice(0, 28));
    emp.ele('CompanyDirector').txt('no');
  }

  // SA106 — foreign income (core differentiator). Grouped by income type.
  const foreign = returnObj.sa106?.foreignIncome || [];
  if (foreign.length) {
    const sa106 = mtr.ele('SA106');
    const ftcrTotal = calc?.ftcr?.totalAllowedCredit || 0;
    if (ftcrTotal > 0) sa106.ele('ForeignTaxCreditRelief').txt(money(ftcrTotal));

    const addSources = (container: any, items: typeof foreign) => {
      for (const it of items) {
        const src = container.ele('IncomeSource');
        src.ele('CountryCode').txt(it.countryCode);
        src.ele('IncomeBeforeTax').txt(money(it.grossAmount));
        if (it.foreignTaxPaid > 0) src.ele('ForeignTax').txt(money(it.foreignTaxPaid));
        if (it.claimFtcr) src.ele('ClaimToFTCR').txt('yes');
      }
    };
    const savings = foreign.filter(i => i.incomeType === 'savings');
    const dividends = foreign.filter(i => i.incomeType === 'dividends');
    if (savings.length) addSources(sa106.ele('OverseasSavings'), savings);
    if (dividends.length) addSources(sa106.ele('OverseasDividendIncome'), dividends);
  }

  // SA109 — residence & domicile (core differentiator).
  if (returnObj.sa109) {
    const s = returnObj.sa109.residenceStatus;
    const sa109 = mtr.ele('SA109');
    if (s.srtResult === 'non_resident' || s.srtResult === 'split_year') {
      const rs = sa109.ele('ResidenceStatus');
      if (s.srtResult === 'non_resident') rs.ele('NotResidentInUK').txt('yes');
      if (s.srtResult === 'split_year') rs.ele('RequestForSplitYearTreatment').txt('yes');
    }
    const t = sa109.ele('TimeSpentInUK');
    t.ele('NumberOfDaysSpentInUK').txt(String(Math.min(s.daysInUk ?? 0, 366)));
  }

  // SA110 — tax calculation summary (required).
  const sa110 = mtr.ele('SA110');
  sa110.ele('SelfAssessment').ele('TotalTaxEtcDue').txt(money(totalDuePence));
  sa110.ele('UnderpaidTax');

  // Declaration (required).
  mtr.ele('Declaration').ele('AgentDeclaration').txt('yes');

  const xmlString = gtm.end({ prettyPrint: true });
  const actualIRmark = calculateIRmark(xmlString);
  return xmlString.replace('placeholder_irmark', actualIRmark);
}

/**
 * Generic IRmark for a GovTalk envelope. Verified byte-exact against HMRC's
 * official reference vector (irmarkexample-submission.xml -> RPfWtxHeCZRcwfitnIJmK9xc4OQ=).
 * Algorithm: take <Body>, remove <IRmark>, inclusive W3C C14N, SHA-1, Base64.
 */
export function calculateIRmark(fullXml: string): string {
  const doc = new DOMParser().parseFromString(fullXml, 'text/xml');
  const body =
    doc.getElementsByTagNameNS('http://www.govtalk.gov.uk/CM/envelope', 'Body')[0] ||
    doc.getElementsByTagName('Body')[0];
  if (!body) throw new Error('Invalid GovTalk envelope: <Body> tag not found.');

  const marks = doc.getElementsByTagNameNS('*', 'IRmark');
  for (let i = marks.length - 1; i >= 0; i--) marks[i].parentNode?.removeChild(marks[i]);

  const canonical = new C14nCanonicalization().process(body as unknown as Node, {}).toString();
  return createHash('sha1').update(canonical, 'utf8').digest('base64');
}
