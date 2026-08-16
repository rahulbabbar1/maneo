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
  // UTR must come from verified client record — never hardcoded.
  const utr = returnObj.clientDetails?.utr;
  if (!utr || !/^\d{10}$/.test(utr)) {
    throw new Error('Cannot build HMRC XML: client UTR is missing or invalid. A valid 10-digit UTR is required.');
  }
  const periodEnd = periodEndFor(returnObj.taxYear || '2025-26');

  // Verified figures from the deterministic engine (never hand-computed here).
  const config = CONFIGS[returnObj.taxYear]
    ? getConfig(returnObj.taxYear)
    : getConfig(Object.keys(CONFIGS).sort().reverse()[0]);
  const calc: any = computeFullReturn(returnObj, config);

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

  // SA100 — main return (required first).
  const sa100 = mtr.ele('SA100');
  const reliefs = returnObj.sa100?.reliefs || {};
  sa100.ele('YourPersonalDetails').ele('TaxpayerStatus').txt(taxpayerStatus(region));

  // YourTaxReturn checkboxes for present schedules.
  const yourTaxReturn = sa100.ele('YourTaxReturn');
  if ((returnObj.sa102 || []).length > 0) {
    yourTaxReturn.ele('EmploymentSchedule').txt('yes');
    yourTaxReturn.ele('NumberOfEmploymentSchedules').txt(String(returnObj.sa102.length));
  }
  if ((returnObj.sa106?.foreignIncome || []).length > 0) {
    yourTaxReturn.ele('ForeignSchedule').txt('yes');
  }
  if ((returnObj.sa108?.disposals || []).length > 0) {
    yourTaxReturn.ele('CapitalGainsSchedule').txt('yes');
    yourTaxReturn.ele('CapitalGainsComputationAttached').txt('yes');
  }
  if (returnObj.sa109) {
    yourTaxReturn.ele('ResidenceFIGschedule').txt('yes');
  }

  // Student Loan repayments (part of SA100).
  const sl = returnObj.sa101?.studentLoan || returnObj.sa100?.reliefs && (returnObj.sa100 as any).studentLoan;
  if (sl?.planType && sl.planType !== 'none') {
    const slEl = sa100.ele('StudentLoanRepayments');
    slEl.ele('IncomeContingentStudentLoanNotification').txt('yes');
    if (sl.planType === 'postgraduate') {
      slEl.ele('PostgraduateLoanPlanType').txt('03');
    } else {
      const planCode = sl.planType === 'plan_1' ? '01' : sl.planType === 'plan_2' ? '02' : '04';
      slEl.ele('PlanType').txt(planCode);
    }
  }

  // UK investment income (part of SA100).
  if (returnObj.sa100?.income?.ukSavingsIncome || returnObj.sa100?.income?.ukDividendIncome) {
    const inc = sa100.ele('Income');
    const ukInterestDiv = inc.ele('UKInterestAndDividends');
    if ((returnObj.sa100.income.ukSavingsIncome || 0) > 0) {
      ukInterestDiv.ele('UntaxedUKinterestEtc').txt(money(returnObj.sa100.income.ukSavingsIncome));
    }
    if ((returnObj.sa100.income.ukDividendIncome || 0) > 0) {
      ukInterestDiv.ele('CompanyDividends').txt(money(returnObj.sa100.income.ukDividendIncome));
    }
  }

  // Tax Reliefs (part of SA100).
  if (reliefs.giftAidGrossedUp || reliefs.relievablePensionContributions) {
    const tr = sa100.ele('TaxReliefs');
    if ((reliefs.relievablePensionContributions || 0) > 0) {
      tr.ele('Pensions').ele('PaymentsToRegisteredPensionSchemes').txt(money(reliefs.relievablePensionContributions));
    }
    if ((reliefs.giftAidGrossedUp || 0) > 0) {
      const netGiftAid = Math.round(reliefs.giftAidGrossedUp * 0.8);
      tr.ele('CharitableGiving').ele('GiftAidPaymentsMadeInYear').txt(money(netGiftAid));
    }
  }

  // High Income Child Benefit Charge (part of SA100).
  const hicbc = returnObj.sa101?.highIncomeChildBenefitCharge || (returnObj.sa100 as any)?.highIncomeChildBenefitCharge;
  if (hicbc?.benefitAmountReceived && hicbc.benefitAmountReceived > 0) {
    const hc = sa100.ele('HighIncomeChildBenefitCharge');
    hc.ele('AmountReceived').txt(money(hicbc.benefitAmountReceived));
    if (hicbc.numberOfChildren > 0) {
      hc.ele('NumberOfChildren').txt(String(hicbc.numberOfChildren));
    }
  }

  // SA102 — one per employment (schema allows up to 50).
  for (const job of returnObj.sa102 || []) {
    const emp = mtr.ele('SA102').ele('Employment');
    if (job.grossPay) emp.ele('PayFromEmployment').txt(money(job.grossPay));
    if (job.taxDeducted) emp.ele('TaxTakenOffPay').txt(money(job.taxDeducted));
    emp.ele('EmployerPAYEReference').txt((job.employerRef || 'N/A').slice(0, 17));
    if (job.employerName) emp.ele('EmployersName').txt(job.employerName.slice(0, 28));
    emp.ele('CompanyDirector').txt('no');
  }

  // SA106 — foreign income. Grouped by income type.
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

  // Helper for SA108 asset types
  const buildAssetTypeNode = (parent: any, name: string, items: any[]) => {
    if (items.length === 0) return;
    const node = parent.ele(name);
    let proceeds = 0;
    let costs = 0;
    let gains = 0;
    let losses = 0;

    for (const d of items) {
      const gain = Math.max(0, (d.proceeds || 0) - (d.costs || 0));
      const loss = Math.max(0, (d.costs || 0) - (d.proceeds || 0)) + (d.losses || 0);
      proceeds += d.proceeds || 0;
      costs += d.costs || 0;
      gains += gain;
      losses += loss;
    }

    node.ele('NumberOfDisposals').txt(String(items.length));
    node.ele('DisposalProceeds').txt(money(proceeds));
    node.ele('AllowableCosts').txt(money(costs));
    const gainsEl = name === 'ResidentialPropertyAndCarriedInterest'
      ? 'GainsOnResidentialPropertyInTheYear'
      : 'GainsInTheYear';
    node.ele(gainsEl).txt(money(gains));
    node.ele('LossesInTheYear').txt(money(losses));
  };

  // SA108 — capital gains. Structured and grouped by asset type in schema order.
  if (returnObj.sa108?.disposals?.length) {
    const sa108 = mtr.ele('SA108');
    const disposals = returnObj.sa108.disposals;

    const residential = disposals.filter(d => d.assetType === 'residential_property');
    const other = disposals.filter(d => d.assetType === 'other_property' || d.assetType === 'other');
    const listed = disposals.filter(d => d.assetType === 'listed_shares');
    const unlisted = disposals.filter(d => d.assetType === 'unlisted_shares');

    buildAssetTypeNode(sa108, 'ResidentialPropertyAndCarriedInterest', residential);
    buildAssetTypeNode(sa108, 'OtherPropertyAssetsAndGains', other);
    buildAssetTypeNode(sa108, 'ListedSharesAndSecurities', listed);
    buildAssetTypeNode(sa108, 'UnlistedSharesAndSecurities', unlisted);

    // Losses and adjustments
    const bfApplied = calc?.cgt?.broughtForwardLossesApplied || 0;
    const badrGains = disposals
      .filter(d => d.claimBadr)
      .reduce((sum, d) => sum + Math.max(0, (d.proceeds || 0) - (d.costs || 0)), 0);

    let totalInYearLosses = 0;
    let totalInYearGains = 0;
    for (const d of disposals) {
      const gain = Math.max(0, (d.proceeds || 0) - (d.costs || 0));
      const loss = Math.max(0, (d.costs || 0) - (d.proceeds || 0)) + (d.losses || 0);
      totalInYearGains += gain;
      totalInYearLosses += loss;
    }

    const unusedInYearLosses = Math.max(0, totalInYearLosses - totalInYearGains);
    const unusedBfLosses = Math.max(0, (returnObj.sa108.broughtForwardLosses || 0) - bfApplied);
    const lossesCarriedForward = unusedInYearLosses + unusedBfLosses;

    if (bfApplied > 0 || lossesCarriedForward > 0 || badrGains > 0) {
      const la = sa108.ele('LossesAndAdjustments');
      if (bfApplied > 0) la.ele('LossesBroughtForwardAndUsedInTheReturnYear').txt(money(bfApplied));
      if (lossesCarriedForward > 0) la.ele('LossesToBeCarriedForward').txt(money(lossesCarriedForward));
      if (badrGains > 0) la.ele('GainsQualifyingForBusinessAssetDisposalRelief').txt(money(badrGains));
    }
  }

  // SA109 — residence & domicile.
  if (returnObj.sa109) {
    const s = returnObj.sa109.residenceStatus;
    const sa109 = mtr.ele('SA109');
    const rs = sa109.ele('ResidenceStatus');
    if (s.srtResult === 'non_resident') {
      rs.ele('NotResidentInUK').txt('yes');
    }
    if (s.srtResult === 'split_year') {
      rs.ele('RequestForSplitYearTreatment').txt('yes');
      const date = calc?.splitDate || s.arrivalDate || s.departureDate;
      if (date) {
        rs.ele('SplitYearTreatmentDateFromWhichTheUKpartYearBeginsOrEnds').txt(date);
      }
    }
    const t = sa109.ele('TimeSpentInUK');
    t.ele('NumberOfDaysSpentInUK').txt(String(Math.min(s.daysInUk ?? 0, 366)));
  }

  // SA110 — tax calculation summary.
  const totalDuePence =
    (calc?.incomeTax?.incomeTaxTotal || 0) +
    (calc?.cgt?.totalCgtDue || 0) +
    (calc?.charges?.hicbcAmount || 0) +
    (calc?.charges?.studentLoanBalanceDue || 0) -
    (calc?.ftcr?.totalAllowedCredit || 0);

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
