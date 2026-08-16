import { Return } from '@uk-sa-app/return-model';
import { checkIndividualExclusions, ExclusionsReport, getConfig, configHash } from '@uk-sa-app/tax-config';
import { reconcileReturnAgainstMethodology, ReconciliationReport, computeFullReturn } from '@uk-sa-app/tax-core';
import { buildLegacySaXml, calculateIRmark } from '../xml.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { XmlDocument, XsdValidator } from 'libxml2-wasm';

export interface SubmissionGateCheckPart {
  partName: string;
  passed: boolean;
  details: string;
}

export interface SubmissionGateResult {
  canSubmitOnline: boolean;
  refusalReason?: string;
  paperGuidance?: string;
  parts: SubmissionGateCheckPart[];
}

/**
 * Validates XML content against the vendored HMRC MTR-v1-2.xsd schema.
 * Fails closed if the schema file cannot be found or if any validation error occurs.
 */
function validateXmlAgainstSchema(xmlContent: string): { valid: boolean; errors: string[] } {
  try {
    const candidatePaths = [
      resolve(process.cwd(), 'packages/hmrc-artefacts/schemas/2025-26/MTR-v1-2.xsd'),
      resolve(process.cwd(), '../../packages/hmrc-artefacts/schemas/2025-26/MTR-v1-2.xsd'),
    ];

    let xsdPath = candidatePaths.find(p => existsSync(p));
    if (!xsdPath) {
      return { valid: false, errors: ['HMRC schema file MTR-v1-2.xsd not found — failing closed for safety'] };
    }

    const xsdDoc = XmlDocument.fromString(readFileSync(xsdPath, 'utf-8'));
    const xsdValidator = XsdValidator.fromDoc(xsdDoc);

    const gtDoc = XmlDocument.fromString(xmlContent);
    const irEnv = gtDoc.get('//*[local-name()="IRenvelope"]');

    if (!irEnv) {
      gtDoc.dispose();
      xsdDoc.dispose();
      return { valid: false, errors: ['IRenvelope node not found in envelope XML'] };
    }

    const payloadDoc = XmlDocument.fromString(irEnv.toString());
    xsdValidator.validate(payloadDoc);

    payloadDoc.dispose();
    gtDoc.dispose();
    xsdDoc.dispose();

    return { valid: true, errors: [] };
  } catch (err: any) {
    return { valid: false, errors: [err?.message || String(err)] };
  }
}

/**
 * Enforces the four-part SubmissionGate pre-filing checkpoint (T3.4 / T4.2):
 *  Part 1: Deterministic Tax-Core Calculation & Provenance (Strict ConfigHash Signature Match)
 *  Part 2: Zero-Diff Reconciliation against HMRC Methodology
 *  Part 3: Schema & IRmark Validation (MTR-v1-2.xsd via libxml2-wasm, fail-closed)
 *  Part 4: HMRC Individual Exclusions & Special Cases Check
 */
export async function evaluateSubmissionGate(returnObj: Return): Promise<SubmissionGateResult> {
  const parts: SubmissionGateCheckPart[] = [];
  let canSubmitOnline = true;
  let refusalReason: string | undefined;
  let paperGuidance: string | undefined;

  // Part 1: Tax-Core Calculation & Provenance Check
  try {
    if (!returnObj || !returnObj.id || !returnObj.taxYear) {
      throw new Error('Return ID and Tax Year are required for provenance checking.');
    }

    // Scan the input return object for any NaN values (A2/A10 checks)
    const scanForNaN = (obj: any) => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'number') {
        if (Number.isNaN(obj)) throw new Error('Input contains non-numeric NaN value.');
      } else if (typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          scanForNaN(obj[k]);
        }
      }
    };
    scanForNaN(returnObj);

    const config = getConfig(returnObj.taxYear);
    const expectedConfigHash = configHash(config);
    const calc = computeFullReturn(returnObj, config);

    if (!calc || !calc.version || !calc.version.configHash) {
      throw new Error('Tax-core computation failed to produce valid version/configHash signature.');
    }
    if (calc.version.configHash !== expectedConfigHash) {
      throw new Error(`Tax-core configHash mismatch: computed [${calc.version.configHash}] != expected [${expectedConfigHash}]`);
    }

    // Enforce numeric invariants (no NaN or Infinite values)
    const checkNumeric = (val: any, name: string) => {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new Error(`Field ${name} is invalid or non-numeric: ${val}`);
      }
    };
    checkNumeric(calc.balancingPayment, 'balancingPayment');
    checkNumeric(calc.totalIncome, 'totalIncome');
    checkNumeric(calc.adjustedNetIncome, 'adjustedNetIncome');
    checkNumeric(calc.incomeTax.incomeTaxTotal, 'incomeTax.incomeTaxTotal');
    if (calc.cgt) {
      checkNumeric(calc.cgt.totalCgtDue, 'cgt.totalCgtDue');
    }

    // Verify computed totalIncome matches sum of input income sources (provenance check)
    let expectedTotalIncome = 0;
    let grossEmployment = 0;
    for (const emp of returnObj.sa102 || []) {
      const benefits = emp.benefits || {};
      const expenses = emp.expenses || {};
      grossEmployment += (emp.grossPay || 0) + (benefits.companyCars || 0) + (benefits.medicalInsurance || 0) + (benefits.otherBenefits || 0);
      grossEmployment -= (expenses.businessTravel || 0) + (expenses.professionalFees || 0) + (expenses.otherExpenses || 0);
    }
    expectedTotalIncome += Math.max(0, grossEmployment);

    const figElected = returnObj.sa109?.residenceStatus?.figRegimeElected && !calc.figRefusalReason;
    if (returnObj.sa106 && Array.isArray(returnObj.sa106.foreignIncome) && returnObj.sa109?.residenceStatus?.srtResult !== 'non_resident') {
      for (const item of returnObj.sa106.foreignIncome) {
        if (figElected) continue;
        expectedTotalIncome += item.grossAmount || 0;
      }
    }
    expectedTotalIncome += (returnObj.sa100?.income?.ukSavingsIncome || 0);
    expectedTotalIncome += (returnObj.sa100?.income?.ukDividendIncome || 0);

    if (calc.totalIncome !== expectedTotalIncome) {
      throw new Error(`Total income mismatch (provenance check failed): computed ${calc.totalIncome} != expected ${expectedTotalIncome}`);
    }

    // Zero-income return check: cannot have tax liability unless capital gains exist
    if (expectedTotalIncome === 0 && calc.balancingPayment !== 0 && !returnObj.sa108?.disposals?.length) {
      throw new Error('Zero-income return has non-zero tax liability.');
    }

    // FIG Eligibility and Double Benefit Checks (A3 / A10)
    if (returnObj.sa109?.residenceStatus?.figRegimeElected) {
      if (calc.figRefusalReason) {
        throw new Error(calc.figRefusalReason);
      }
      // Electing FIG forfeits the PA. Thus, claiming allowances while on FIG is invalid.
      const reliefs = returnObj.sa100?.reliefs || {};
      if (reliefs.blindPersonsAllowance || reliefs.marriageAllowanceTransferor || reliefs.marriageAllowanceRecipient) {
        throw new Error('FIG regime election disallows claiming or transferring Personal Allowance / Marriage Allowance.');
      }
    }

    // Marriage Allowance Checks (Trap 1 / A10)
    const reliefs = returnObj.sa100?.reliefs || {};
    if (reliefs.marriageAllowanceTransferor) {
      // Transferor must be basic-rate or non-taxpayer. Basic rate limit = £37,700 taxable (or £50,270 adjusted net income)
      const basicLimit = config.incomeTax.rUK.nonSavings[0].limit;
      const threshold = basicLimit + config.personalAllowance;
      if (calc.adjustedNetIncome > threshold) {
        throw new Error('Marriage Allowance transferor must be a non-taxpayer or basic-rate taxpayer.');
      }
    }
    if (reliefs.marriageAllowanceRecipient && calc.totalIncome === 0) {
      throw new Error('Marriage Allowance recipient has no UK income (invalid claim).');
    }
    if (calc.warnings && calc.warnings.some(w => w.startsWith('CRITICAL:'))) {
      const crit = calc.warnings.find(w => w.startsWith('CRITICAL:'))!;
      throw new Error(crit.replace('CRITICAL: ', ''));
    }

    parts.push({
      partName: 'Part 1: Tax-Core Calculation & Provenance',
      passed: true,
      details: `Tax-core calculation verified deterministically (v${calc.version.engineVersion}, configHash: ${calc.version.configHash}).`,
    });
  } catch (err: any) {
    canSubmitOnline = false;
    parts.push({
      partName: 'Part 1: Tax-Core Calculation & Provenance',
      passed: false,
      details: `Tax-core check failed: ${err.message}`,
    });
  }

  // Part 2: Reconciliation Verification
  try {
    const recon: ReconciliationReport = reconcileReturnAgainstMethodology(returnObj, 'SubmissionGate Check');
    if (!recon.passed) {
      canSubmitOnline = false;
      const diffSummary = recon.diffs.map(d => `${d.field}: expected ${d.expectedValue}, got ${d.taxCoreValue}`).join('; ');
      parts.push({
        partName: 'Part 2: Methodology Reconciliation',
        passed: false,
        details: `Reconciliation diff detected: ${diffSummary}`,
      });
    } else {
      parts.push({
        partName: 'Part 2: Methodology Reconciliation',
        passed: true,
        details: 'Zero-diff match against HMRC Calculate Tax & NIC methodology.',
      });
    }
  } catch (err: any) {
    canSubmitOnline = false;
    parts.push({
      partName: 'Part 2: Methodology Reconciliation',
      passed: false,
      details: `Reconciliation harness error: ${err.message}`,
    });
  }

  // Part 3: Schema & IRmark Validation (Fail-closed)
  try {
    const xml = buildLegacySaXml(returnObj);
    const calculatedIRmark = calculateIRmark(xml);
    if (!calculatedIRmark || calculatedIRmark.length < 20) {
      throw new Error('IRmark calculation failed or returned invalid signature.');
    }

    // Verify embedded IRmark in generated XML matches calculated IRmark
    const irMarkMatch = xml.match(/<IRmark[^>]*>([^<]+)<\/IRmark>/);
    const embeddedIRmark = irMarkMatch ? irMarkMatch[1] : null;
    if (!embeddedIRmark || embeddedIRmark === 'placeholder_irmark') {
      throw new Error('XML envelope contains unpopulated or placeholder IRmark.');
    }
    if (embeddedIRmark !== calculatedIRmark) {
      throw new Error(`IRmark mismatch: embedded [${embeddedIRmark}] != calculated [${calculatedIRmark}]`);
    }

    // Validate XML schema against MTR-v1-2.xsd (Strict Fail-Closed)
    const schemaValidation = validateXmlAgainstSchema(xml);
    if (!schemaValidation.valid) {
      canSubmitOnline = false;
      parts.push({
        partName: 'Part 3: Schema & IRmark Validation',
        passed: false,
        details: `XML Schema validation errors (Fail-Closed): ${schemaValidation.errors.join('; ')}`,
      });
    } else {
      parts.push({
        partName: 'Part 3: Schema & IRmark Validation',
        passed: true,
        details: `GovTalk envelope schema valid (MTR-v1-2.xsd); IRmark verified signature: ${calculatedIRmark}`,
      });
    }
  } catch (err: any) {
    canSubmitOnline = false;
    parts.push({
      partName: 'Part 3: Schema & IRmark Validation',
      passed: false,
      details: `Schema/IRmark failure: ${err.message}`,
    });
  }

  // Part 4: Individual Exclusions & Special Cases Check
  const exclusionsReport: ExclusionsReport = checkIndividualExclusions(returnObj);
  if (exclusionsReport.refusalRequired) {
    canSubmitOnline = false;
    const refusalExclusions = exclusionsReport.exclusions.filter(e => e.action === 'refuse_to_paper');
    refusalReason = `Return matches HMRC online filing exclusion(s): ${refusalExclusions.map(e => `[Exclusion #${e.exclusionId}] ${e.issue}`).join('; ')}`;
    paperGuidance = 'This return cannot be filed online due to an HMRC system exclusion. Deliver a signed paper SA100 return on or before 31 January with a reasonable-excuse claim referencing the exclusion ID.';
    parts.push({
      partName: 'Part 4: HMRC Exclusions & Special Cases',
      passed: false,
      details: refusalReason,
    });
  } else {
    parts.push({
      partName: 'Part 4: HMRC Exclusions & Special Cases',
      passed: true,
      details: exclusionsReport.excluded
        ? 'Exclusion check passed with workaround guidance applied.'
        : 'No HMRC online-filing exclusions matched.',
    });
  }

  return {
    canSubmitOnline,
    refusalReason,
    paperGuidance,
    parts,
  };
}
